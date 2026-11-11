/**
 * Draws overlays (track time + progress bar, sonos-bg0.2) onto a key's album art and returns a PNG
 * data URL. Keys are 72 px, drawn at 2x. Where no canvas is available (unit tests) or the art is
 * still decoding, the plain art is returned and the key redraws once the image is ready.
 */
export const KEY_SIZE = 144;

let canvasFactory = () =>
  typeof document !== "undefined" && typeof document.createElement === "function" ? document.createElement("canvas") : null;

/** Test hook: replace how canvases are created (jsdom has no 2D canvas). */
export function _setKeyCanvasFactory(factory) {
  canvasFactory = factory;
}

const images = new Map(); // src -> HTMLImageElement | null
const readyListeners = new Set();

/** Calls back when an image used by a key finishes decoding, so keys can redraw. */
export function onKeyImageReady(callback) {
  readyListeners.add(callback);
  return () => readyListeners.delete(callback);
}

function imageFor(src) {
  if (!src || typeof Image === "undefined") return null;
  let img = images.get(src);
  if (img === undefined) {
    img = new Image();
    img.onload = () => readyListeners.forEach((cb) => cb());
    img.onerror = () => images.set(src, null);
    img.src = src;
    images.set(src, img);
    // Bound the cache: art changes per track; keep the most recent few.
    if (images.size > 16) images.delete(images.keys().next().value);
  }
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

const drawn = new Map(); // cache key -> data URL (the same second is drawn once)

/** Test hook. */
export function _resetKeyImages() {
  images.clear();
  drawn.clear();
}

/**
 * @param {string} base album art (data URL or path)
 * @param {{ text?: string|null, fraction?: number|null }} time
 * @returns {string} composed PNG data URL, or `base` when it cannot be drawn
 */
export function composeKeyImage(base, { text = null, fraction = null } = {}) {
  if (!base || (!text && fraction === null)) return base;
  const barStep = fraction === null ? "none" : Math.round(fraction * 200);
  const cacheKey = `${base.length}:${base.slice(-48)}|${text}|${barStep}`;
  if (drawn.has(cacheKey)) return drawn.get(cacheKey);

  const img = imageFor(base);
  const canvas = img ? canvasFactory() : null;
  const ctx = canvas?.getContext?.("2d");
  if (!ctx) return base;
  const S = KEY_SIZE;
  canvas.width = S;
  canvas.height = S;
  ctx.drawImage(img, 0, 0, S, S);

  // Dark fade at the bottom so the time and bar read on any cover.
  const fade = ctx.createLinearGradient(0, S * 0.58, 0, S);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(1, "rgba(0,0,0,0.78)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, S * 0.58, S, S * 0.42);

  const barX = 14;
  const barW = S - 28;
  const barY = S - 14;
  if (fraction !== null) {
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fillRect(barX, barY, barW, 6);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(barX, barY, Math.max(0, Math.min(1, fraction)) * barW, 6);
  }
  if (text) {
    ctx.font = "600 26px 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    const y = fraction !== null ? barY - 8 : S - 14;
    ctx.strokeText(text, S / 2, y);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(text, S / 2, y);
  }

  const url = canvas.toDataURL("image/png");
  drawn.set(cacheKey, url);
  if (drawn.size > 64) drawn.delete(drawn.keys().next().value);
  return url;
}
