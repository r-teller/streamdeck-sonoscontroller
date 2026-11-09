const LAYOUTS = {
  "./layouts/encoder-bar-0-100.json": {
    title: { rect: [16, 10, 136, 24], fontSize: 16, fontWeight: 600, textAlign: "center" },
    icon: { rect: [16, 40, 48, 48] },
    value: { rect: [76, 40, 108, 32], fontSize: 24, textAlign: "right" },
    indicator: { rect: [76, 74, 108, 12], type: "bar", min: 0, max: 100 },
  },
  "./layouts/encoder-gbar-10-10.json": {
    title: { rect: [16, 10, 136, 24], fontSize: 16, fontWeight: 600, textAlign: "center" },
    icon: { rect: [16, 40, 48, 48] },
    value: { rect: [76, 40, 108, 32], fontSize: 24, textAlign: "right" },
    indicator: { rect: [76, 74, 108, 12], type: "gbar", min: -10, max: 10 },
  },
  "./layouts/encoder-audio-equalizer.json": {
    icon: { rect: [16, 40, 48, 48] },
  },
  "/layouts/encoder-bar-0-100.json": {
    title: { rect: [16, 10, 136, 24], fontSize: 16, fontWeight: 600, textAlign: "center" },
    icon: { rect: [16, 40, 48, 48] },
    value: { rect: [76, 40, 108, 32], fontSize: 24, textAlign: "right" },
    indicator: { rect: [76, 74, 108, 12], type: "bar", min: 0, max: 100 },
  },
  "/layouts/encoder-gbar-10-10.json": {
    title: { rect: [16, 10, 136, 24], fontSize: 16, fontWeight: 600, textAlign: "center" },
    icon: { rect: [16, 40, 48, 48] },
    value: { rect: [76, 40, 108, 32], fontSize: 24, textAlign: "right" },
    indicator: { rect: [76, 74, 108, 12], type: "gbar", min: -10, max: 10 },
  },
  "/layouts/encoder-audio-equalizer.json": {
    icon: { rect: [16, 40, 48, 48] },
  },
};

const tiles = new Map();
let processedCount = 0;

function resolveImage(image) {
  if (!image) return null;
  if (image.startsWith("data:")) return image;
  if (image.startsWith("./")) return "/" + image.slice(2);
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

function renderEncoderTile(tile) {
  const { el, state, prev } = tile;
  const layout = LAYOUTS[state.layout] || LAYOUTS["/layouts/encoder-bar-0-100.json"];
  const indicator = layout.indicator;
  const feedback = state.feedback || { title: "", value: 0, indicator: 0 };

  let changed = false;

  if (!deepEqual(state.feedback, prev.feedback) || !deepEqual(state.layout, prev.layout)) {
    el.innerHTML = "";

    if (layout.title) {
      const titleEl = document.createElement("div");
      titleEl.className = "encoder-title";
      titleEl.style.left = layout.title.rect[0] + "px";
      titleEl.style.top = layout.title.rect[1] + "px";
      titleEl.style.width = layout.title.rect[2] + "px";
      titleEl.style.height = layout.title.rect[3] + "px";
      titleEl.style.fontSize = layout.title.fontSize + "px";
      titleEl.style.fontWeight = layout.title.fontWeight;
      titleEl.style.textAlign = layout.title.textAlign;
      titleEl.textContent = feedback.title || "";
      el.appendChild(titleEl);
    }

    if (layout.icon) {
      const iconEl = document.createElement("img");
      iconEl.className = "encoder-icon";
      iconEl.style.left = layout.icon.rect[0] + "px";
      iconEl.style.top = layout.icon.rect[1] + "px";
      iconEl.style.width = layout.icon.rect[2] + "px";
      iconEl.style.height = layout.icon.rect[3] + "px";
      iconEl.src = state.image ? resolveImage(state.image) : "";
      iconEl.onerror = () => (iconEl.style.display = "none");
      el.appendChild(iconEl);
    }

    if (layout.value) {
      const valueEl = document.createElement("div");
      valueEl.className = "encoder-value";
      valueEl.style.left = layout.value.rect[0] + "px";
      valueEl.style.top = layout.value.rect[1] + "px";
      valueEl.style.width = layout.value.rect[2] + "px";
      valueEl.style.height = layout.value.rect[3] + "px";
      valueEl.style.fontSize = layout.value.fontSize + "px";
      valueEl.style.textAlign = layout.value.textAlign;
      valueEl.textContent = feedback.value != null ? feedback.value : "";
      el.appendChild(valueEl);
    }

    if (indicator) {
      const indicatorEl = document.createElement("div");
      indicatorEl.className = "encoder-indicator";
      indicatorEl.style.left = indicator.rect[0] + "px";
      indicatorEl.style.top = indicator.rect[1] + "px";
      indicatorEl.style.width = indicator.rect[2] + "px";
      indicatorEl.style.height = indicator.rect[3] + "px";

      if (indicator.type === "bar") {
        const fillEl = document.createElement("div");
        fillEl.className = "encoder-indicator-bar";
        const percent = Math.max(
          0,
          Math.min(100, ((feedback.indicator - indicator.min) / (indicator.max - indicator.min)) * 100),
        );
        fillEl.style.width = percent + "%";
        indicatorEl.appendChild(fillEl);
      } else if (indicator.type === "gbar") {
        indicatorEl.style.background = "linear-gradient(to right, #ff0000 0%, yellow 50%, #00ff00 100%)";
        const needleEl = document.createElement("div");
        needleEl.className = "encoder-indicator-needle";
        const percent = Math.max(
          0,
          Math.min(100, ((feedback.indicator - indicator.min) / (indicator.max - indicator.min)) * 100),
        );
        needleEl.style.left = percent + "%";
        indicatorEl.appendChild(needleEl);
      }

      el.appendChild(indicatorEl);
    }

    prev.feedback = JSON.parse(JSON.stringify(state.feedback));
    prev.layout = state.layout;
    changed = true;
  }

  if (changed) {
    tile.redrawCount++;
    updateCaption(tile);
  }
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

window.renderFrames = function renderFrames(frames) {
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
      tile.state.feedback = {
        title: payload.title,
        value: payload.value,
        indicator: payload.indicator,
      };
    } else if (event === "setFeedbackLayout") {
      tile.state.layout = payload.layout;
    }
  }

  renderAllTiles();
};

window.getTile = function getTile(context) {
  return tiles.get(context);
};

window.getRedrawCount = function getRedrawCount(context) {
  return tiles.get(context)?.redrawCount ?? 0;
};
