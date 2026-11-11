/**
 * Draws overlays (track time + progress bar, sonos-bg0.2; favorite heart, sonos-bg0.3) onto a key's album art and returns a PNG
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

// Lucide "heart" outline (24 x 24), the same shape as the favorite key.
export const HEART_PATH =
  "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z";
export const HEART_COLOR = "#ff5a6e";

function drawBadge(ctx, S) {
  const r = 20;
  const cx = S - r - 8;
  const cy = r + 8;
  ctx.fillStyle = "rgba(0,0,0,0.62)";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  if (typeof Path2D === "undefined") return;
  ctx.save();
  ctx.translate(cx - 13, cy - 13);
  ctx.scale(26 / 24, 26 / 24);
  ctx.fillStyle = HEART_COLOR;
  ctx.fill(new Path2D(HEART_PATH));
  ctx.restore();
}

/** Test hook. */
export function _resetKeyImages() {
  images.clear();
  drawn.clear();
}

/**
 * @param {string} base album art (data URL or path)
 * @param {{ text?: string|null, fraction?: number|null, badge?: boolean }} overlays
 * @returns {string} composed PNG data URL, or `base` when it cannot be drawn
 */
export function composeKeyImage(base, { text = null, fraction = null, badge = false } = {}) {
  if (!base || (!text && fraction === null && !badge)) return base;
  const barStep = fraction === null ? "none" : Math.round(fraction * 200);
  const cacheKey = `${base.length}:${base.slice(-48)}|${text}|${barStep}|${badge}`;
  if (drawn.has(cacheKey)) return drawn.get(cacheKey);

  const img = imageFor(base);
  const canvas = img ? canvasFactory() : null;
  const ctx = canvas?.getContext?.("2d");
  if (!ctx) return base;
  const S = KEY_SIZE;
  canvas.width = S;
  canvas.height = S;
  ctx.drawImage(img, 0, 0, S, S);

  if (badge) drawBadge(ctx, S);
  if (!text && fraction === null) return remember(cacheKey, canvas.toDataURL("image/png"));

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

  return remember(cacheKey, canvas.toDataURL("image/png"));
}

function remember(cacheKey, url) {
  drawn.set(cacheKey, url);
  if (drawn.size > 64) drawn.delete(drawn.keys().next().value);
  return url;
}
