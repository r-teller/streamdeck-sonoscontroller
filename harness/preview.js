// Dial layouts are loaded from the plugin's real layout files (public/layouts/*.json), so a wrong
// rect or key in a layout shows up in screenshots (sonos-8px.4).
const DEFAULT_LAYOUT = "/layouts/encoder-bar-0-100.json";
const layoutCache = new Map();

function layoutPath(layout) {
  if (!layout) return DEFAULT_LAYOUT;
  if (layout.startsWith("./")) return "/" + layout.slice(2);
  if (layout.startsWith("/")) return layout;
  return "/" + layout;
}

async function loadLayout(layout) {
  const path = layoutPath(layout);
  if (!layoutCache.has(path)) {
    layoutCache.set(
      path,
      fetch(path)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${path}: HTTP ${r.status}`))))
        .catch((err) => {
          console.warn("preview: layout not loaded", err.message);
          return { id: "missing", items: [] };
        }),
    );
  }
  return layoutCache.get(path);
}

const tiles = new Map();
let processedCount = 0;

function resolveImage(image) {
  if (!image) return null;
  if (image.startsWith("data:")) return image;
  if (image.startsWith("./")) return "/" + image.slice(2);
  // setFeedback pixmap values are plugin-relative paths ("images/keys/x.png"); the preview page
  // lives under /harness/, so resolve them from the plugin root.
  if (!image.startsWith("/") && !/^[a-z]+:/i.test(image)) return "/" + image;
  return image;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!keysB.includes(key) || !deepEqual(a[key], b[key])) return false;
  }
  return true;
}

function createKeyTile(context) {
  const el = document.createElement("div");
  el.className = "tile key-tile";
  el.innerHTML = `
    <img src="" alt="" onerror="this.style.display='none'">
    <div class="tile-title" style="top: 0; bottom: 0; display: flex; align-items: flex-end; justify-content: center; padding: 2px;"></div>
    <div class="tile-state" style="display:none;"></div>
    <div class="tile-alert" style="display:none;">⚠</div>
  `;
  const img = el.querySelector("img");
  const titleEl = el.querySelector(".tile-title");
  const stateEl = el.querySelector(".tile-state");
  const alertEl = el.querySelector(".tile-alert");
  const wrap = document.createElement("div");
  wrap.className = "tile-wrap";
  wrap.appendChild(el);
  const caption = document.createElement("div");
  caption.className = "tile-caption";
  wrap.appendChild(caption);
  const tile = {
    el,
    kind: "key",
    state: {
      image: null,
      title: null,
      stateIndex: 0,
      alert: false,
      feedback: null,
      layout: null,
    },
    redrawCount: 0,
    prev: {
      image: null,
      title: null,
      stateIndex: 0,
      alert: false,
    },
    wrap,
    caption,
    context,
  };
  tiles.set(context, tile);
  return tile;
}

function createEncoderTile(context) {
  const el = document.createElement("div");
  el.className = "tile encoder-tile";
  const wrap = document.createElement("div");
  wrap.className = "tile-wrap";
  wrap.appendChild(el);
  const caption = document.createElement("div");
  caption.className = "tile-caption";
  wrap.appendChild(caption);
  const tile = {
    el,
    kind: "encoder",
    state: {
      image: null,
      title: null,
      stateIndex: 0,
      alert: false,
      feedback: null,
      layout: null,
    },
    redrawCount: 0,
    prev: {
      feedback: null,
      layout: null,
    },
    wrap,
    caption,
    context,
  };
  tiles.set(context, tile);
  return tile;
}

function updateCaption(tile) {
  tile.caption.dataset.redraws = String(tile.redrawCount);
  tile.caption.textContent = tile.context.slice(0, 12) + " · r" + tile.redrawCount;
}

function renderKeyTile(tile) {
  const { el, state, prev } = tile;
  const img = el.querySelector("img");
  const titleEl = el.querySelector(".tile-title");
  const stateEl = el.querySelector(".tile-state");
  const alertEl = el.querySelector(".tile-alert");

  let changed = false;

  if (!deepEqual(state.image, prev.image)) {
    img.src = resolveImage(state.image) || "";
    prev.image = state.image;
    changed = true;
  }

  if (!deepEqual(state.title, prev.title)) {
    titleEl.textContent = state.title || "";
    prev.title = state.title;
    changed = true;
  }

  if (state.stateIndex !== prev.stateIndex) {
    stateEl.textContent = state.stateIndex;
    stateEl.style.display = state.stateIndex !== 0 ? "block" : "none";
    prev.stateIndex = state.stateIndex;
    changed = true;
  }

  if (state.alert !== prev.alert) {
    alertEl.style.display = state.alert ? "flex" : "none";
    prev.alert = state.alert;
    changed = true;
  }

  if (changed) {
    tile.redrawCount++;
    updateCaption(tile);
  }
}

/** A setFeedback value is either a plain value or an object with a `value` and display overrides. */
function feedbackValue(entry) {
  return entry !== null && typeof entry === "object" ? entry.value : entry;
}

function placeItem(node, rect) {
  node.style.position = "absolute";
  node.style.left = rect[0] + "px";
  node.style.top = rect[1] + "px";
  node.style.width = rect[2] + "px";
  node.style.height = rect[3] + "px";
}

function renderLayoutItem(item, entry, tile) {
  const value = entry === undefined ? item.value : feedbackValue(entry);
  if (item.type === "text") {
    const textEl = document.createElement("div");
    textEl.className = "encoder-text";
    placeItem(textEl, item.rect);
    textEl.style.fontSize = (item.font?.size ?? 16) + "px";
    if (item.font?.weight) textEl.style.fontWeight = item.font.weight;
    textEl.style.textAlign = item.alignment ?? "center";
    if (item.color) textEl.style.color = item.color;
    textEl.textContent = value ?? "";
    return textEl;
  }
  if (item.type === "pixmap") {
    const imgEl = document.createElement("img");
    imgEl.className = "encoder-pixmap";
    placeItem(imgEl, item.rect);
    // Stream Deck shows the action's icon (manifest "Icon") in the "icon" item until feedback
    // sets it. Frames do not name the action, so callers pass it via renderFrames(..., { actionIcons }).
    const source = value ?? (item.key === "icon" ? (tile.state.image ?? actionIcons[tile.context]) : null);
    if (source) imgEl.src = resolveImage(source);
    else imgEl.style.display = "none";
    imgEl.onerror = () => (imgEl.style.display = "none");
    return imgEl;
  }
  if (item.type === "bar" || item.type === "gbar") {
    const barEl = document.createElement("div");
    barEl.className = "encoder-indicator";
    placeItem(barEl, item.rect);
    const min = item.range?.min ?? 0;
    const max = item.range?.max ?? 100;
    const percent = Math.max(0, Math.min(100, (((value ?? min) - min) / (max - min)) * 100));
    if (item.type === "bar") {
      const fillEl = document.createElement("div");
      fillEl.className = "encoder-indicator-bar";
      fillEl.style.width = percent + "%";
      barEl.appendChild(fillEl);
    } else {
      barEl.style.background = "linear-gradient(to right, #ff0000 0%, yellow 50%, #00ff00 100%)";
      const needleEl = document.createElement("div");
      needleEl.className = "encoder-indicator-needle";
      needleEl.style.left = percent + "%";
      barEl.appendChild(needleEl);
    }
    return barEl;
  }
  return null;
}

function renderEncoderTile(tile) {
  const { el, state, prev } = tile;
  const feedback = state.feedback || {};

  if (
    deepEqual(state.feedback, prev.feedback) &&
    deepEqual(state.layoutDef, prev.layoutDef) &&
    state.image === prev.image &&
    state.alert === prev.alert
  ) {
    return;
  }

  el.innerHTML = "";
  for (const item of state.layoutDef?.items ?? []) {
    const node = renderLayoutItem(item, feedback[item.key], tile);
    if (node) el.appendChild(node);
  }

  // showAlert on a dial: same marker as key tiles (the strip itself keeps its last feedback).
  const alertEl = document.createElement("div");
  alertEl.className = "tile-alert";
  alertEl.textContent = "\u26a0";
  alertEl.style.display = state.alert ? "flex" : "none";
  el.appendChild(alertEl);

  prev.feedback = JSON.parse(JSON.stringify(state.feedback ?? null));
  prev.layoutDef = state.layoutDef;
  prev.image = state.image;
  prev.alert = state.alert;
  tile.redrawCount++;
  updateCaption(tile);
}

/** Resolves when every image in the preview has loaded (or failed), so screenshots are complete. */
function imagesSettled() {
  const pending = [...document.querySelectorAll("#tiles img")].filter((img) => img.src && !img.complete);
  return Promise.all(
    pending.map(
      (img) =>
        new Promise((resolve) => {
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
        }),
    ),
  );
}

function renderAllTiles() {
  for (const [context, tile] of tiles) {
    if (tile.kind === "key") {
      renderKeyTile(tile);
    } else {
      renderEncoderTile(tile);
    }
  }
}

window.resetPreview = function resetPreview() {
  tiles.clear();
  processedCount = 0;
  document.getElementById("tiles").innerHTML = "";
};

let actionIcons = {};

window.renderFrames = async function renderFrames(frames, { actionIcons: icons } = {}) {
  if (icons) actionIcons = icons;
  if (frames.length < processedCount) {
    resetPreview();
  }

  const newFrames = frames.slice(processedCount);
  processedCount = frames.length;

  for (const frame of newFrames) {
    const { event, context, payload } = frame;
    if (!context) continue;

    let tile = tiles.get(context);
    if (!tile) {
      if (event === "setFeedback" || event === "setFeedbackLayout") {
        tile = createEncoderTile(context);
      } else {
        tile = createKeyTile(context);
      }
      document.getElementById("tiles").appendChild(tile.wrap);
    }

    if (event === "setImage") {
      const image = payload.image;
      if (image !== null && image !== undefined) {
        tile.state.image = image;
      } else {
        tile.state.image = null;
      }
      tile.state.alert = false;
    } else if (event === "setTitle") {
      const title = payload.title;
      if (title !== null && title !== undefined) {
        tile.state.title = title;
      } else {
        tile.state.title = null;
      }
      tile.state.alert = false;
    } else if (event === "setState") {
      tile.state.stateIndex = payload.state;
      tile.state.alert = false;
    } else if (event === "showAlert") {
      tile.state.alert = true;
    } else if (event === "setFeedback") {
      // Like Stream Deck, setFeedback is a partial update: keys left out keep their last value.
      tile.state.feedback = { ...(tile.state.feedback ?? {}), ...payload };
      tile.state.alert = false;
    } else if (event === "setFeedbackLayout") {
      tile.state.layout = payload.layout;
    }
  }

  for (const tile of tiles.values()) {
    if (tile.kind === "encoder") tile.state.layoutDef = await loadLayout(tile.state.layout);
  }
  renderAllTiles();
  await imagesSettled();
};

window.getTile = function getTile(context) {
  return tiles.get(context);
};

window.getRedrawCount = function getRedrawCount(context) {
  return tiles.get(context)?.redrawCount ?? 0;
};
