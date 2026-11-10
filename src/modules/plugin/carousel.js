/**
 * Card carousel for a dial's touch strip (sonos-gen.1).
 *
 * The strip shows a row of cards: the selected card large in the middle, the previous and next
 * cards smaller and partly cut off at the edges. The card row is drawn into one image (layout item
 * "cards"); the caption and position line are plain text items so Stream Deck draws them natively.
 *
 * Turning a dial moves the selection immediately (browse state, one slide animation per step); the
 * action's own handler applies the choice once turning stops.
 */

export const CAROUSEL_LAYOUT = "layouts/encoder-carousel.json";

// Geometry of the "cards" pixmap item (must match public/layouts/encoder-carousel.json).
export const CARDS_WIDTH = 200;
export const CARDS_HEIGHT = 66;
const CENTER_SIZE = 56;
const SIDE_SIZE = 40;
const SPACING = 84; // distance between card centres; side cards end up partly off the strip
const SIDE_ALPHA = 0.45;

export const ANIMATION_FRAMES = [2 / 3, 1 / 3, 0];
export const ANIMATION_FRAME_MS = 40;

/** Wraps an index into 0..count-1. */
export function wrapIndex(index, count) {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

/**
 * Where each visible card goes for a given selection and slide offset.
 * offset is in card slots: +1 means the cards are still one slot to the right of their resting
 * place (the start of a step to the right), 0 is at rest.
 *
 * @param {{count: number, index: number, offset?: number}} p
 * @returns {Array<{item: number, x: number, y: number, size: number, alpha: number, center: boolean}>}
 */
export function cardPlacements({ count, index, offset = 0 }) {
  if (count <= 0) return [];
  const rels = count === 1 ? [0] : count === 2 ? [0, 1] : [-2, -1, 0, 1, 2];
  const placements = [];
  for (const rel of rels) {
    const pos = rel + offset; // slots from the centre
    const distance = Math.min(1, Math.abs(pos));
    const size = Math.round(CENTER_SIZE - (CENTER_SIZE - SIDE_SIZE) * distance);
    const cx = CARDS_WIDTH / 2 + pos * SPACING;
    const x = Math.round(cx - size / 2);
    if (x + size <= 0 || x >= CARDS_WIDTH) continue; // fully off the strip
    placements.push({
      item: wrapIndex(index + rel, count),
      x,
      y: Math.round((CARDS_HEIGHT - size) / 2),
      size,
      alpha: 1 - (1 - SIDE_ALPHA) * distance,
      center: rel === 0,
    });
  }
  // Draw side cards first so the centre card is on top.
  return placements.sort((a, b) => Number(a.center) - Number(b.center));
}

// ---------------------------------------------------------------------------------------------
// Browse state and slide animation, per dial context
// ---------------------------------------------------------------------------------------------

const browse = new Map(); // context -> { pending, offset, timer, frame }
let renderHook = () => {};

/** Called with a context whenever its carousel needs to be drawn again (animation frame, art loaded). */
export function setCarouselRenderHook(hook) {
  renderHook = typeof hook === "function" ? hook : () => {};
}

function entry(context) {
  if (!browse.has(context)) browse.set(context, { pending: 0, offset: 0, timer: null, frame: 0 });
  return browse.get(context);
}

/** Net ticks turned since the last applied choice (0 when not browsing). */
export function pendingTicks(context) {
  return browse.get(context)?.pending ?? 0;
}

/** Current slide offset in card slots (0 when at rest). */
export function slideOffset(context) {
  return browse.get(context)?.offset ?? 0;
}

function animate(context, direction) {
  const e = entry(context);
  if (e.timer) clearTimeout(e.timer);
  // A new step while a slide is still running starts from where the cards are now, so a fast
  // spin never queues frames; it just keeps sliding toward the latest card.
  e.frame = 0;
  const run = () => {
    e.offset = direction * ANIMATION_FRAMES[e.frame];
    renderHook(context);
    e.frame += 1;
    e.timer = e.frame < ANIMATION_FRAMES.length ? setTimeout(run, ANIMATION_FRAME_MS) : null;
  };
  run();
}

/** One dial step (or several) while browsing: move the selection now and slide the cards. */
export function browseTick(context, ticks) {
  if (!ticks) return;
  const e = entry(context);
  e.pending += ticks;
  animate(context, Math.sign(ticks));
}

/**
 * Show the next card without changing the browse offset (push/tap "next"): the action projects the
 * new selection itself; this only plays the slide.
 */
export function slideNext(context) {
  animate(context, 1);
}

/**
 * `applied` ticks were applied (or dropped): the selection follows the speaker state again, keeping
 * any ticks turned while the speaker call was in flight.
 */
export function endBrowse(context, applied) {
  const e = browse.get(context);
  if (!e) return;
  e.pending = applied === undefined ? 0 : e.pending - applied;
}

export function clearCarousel(context) {
  const e = browse.get(context);
  if (e?.timer) clearTimeout(e.timer);
  browse.delete(context);
}

export function _resetCarousels() {
  for (const context of [...browse.keys()]) clearCarousel(context);
}

// ---------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------

const images = new Map(); // src -> HTMLImageElement
let canvasFactory = () =>
  typeof document !== "undefined" && typeof document.createElement === "function" ? document.createElement("canvas") : null;

/** Test hook: replace how canvases are created (jsdom has no 2D canvas). */
export function _setCanvasFactory(factory) {
  canvasFactory = factory;
}

function imageFor(src) {
  if (!src || typeof Image === "undefined") return null;
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => renderAllActive();
    img.onerror = () => images.set(src, null);
    img.src = src;
    images.set(src, img);
  }
  return img && img.complete && img.naturalWidth > 0 ? img : null;
}

const activeContexts = new Set();
function renderAllActive() {
  for (const context of activeContexts) renderHook(context);
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Draws the card row and returns it as a PNG data URL, or null where no canvas is available.
 * Images that are still loading are drawn as placeholders; the carousel redraws when they arrive.
 *
 * @param {string} context
 * @param {{cards: Array<{image?: string, placeholder?: string}>, index: number, offset?: number}} model
 */
export function drawCards(context, { cards, index, offset = 0, dim = false }) {
  activeContexts.add(context);
  const canvas = canvasFactory();
  const ctx = canvas?.getContext?.("2d");
  if (!ctx) return null;
  canvas.width = CARDS_WIDTH;
  canvas.height = CARDS_HEIGHT;
  ctx.clearRect(0, 0, CARDS_WIDTH, CARDS_HEIGHT);

  for (const p of cardPlacements({ count: cards.length, index, offset })) {
    const card = cards[p.item] ?? {};
    ctx.save();
    ctx.globalAlpha = dim ? p.alpha * 0.4 : p.alpha;
    roundedRect(ctx, p.x, p.y, p.size, p.size, 6);
    ctx.clip();
    const img = imageFor(card.image);
    if (img) {
      ctx.drawImage(img, p.x, p.y, p.size, p.size);
    } else {
      ctx.fillStyle = "#2a2a2a";
      ctx.fillRect(p.x, p.y, p.size, p.size);
      ctx.fillStyle = "#9a9a9a";
      ctx.font = `600 ${Math.round(p.size * 0.42)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(card.placeholder ?? "♪", p.x + p.size / 2, p.y + p.size / 2 + 1);
    }
    ctx.restore();
    if (p.center && !dim) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2;
      roundedRect(ctx, p.x + 1, p.y + 1, p.size - 2, p.size - 2, 6);
      ctx.stroke();
      ctx.restore();
    }
  }
  return canvas.toDataURL("image/png");
}

/**
 * Feedback payload for a carousel dial.
 * @param {string} context
 * @param {{cards: Array<{image?: string, placeholder?: string, caption?: string}>, index: number,
 *   detail?: string}} model - detail defaults to "i / n"
 */
export function carouselFeedback(context, { cards, index, detail }) {
  const count = cards.length;
  const i = wrapIndex(index, count);
  return {
    cards: drawCards(context, { cards, index: i, offset: slideOffset(context) }) ?? "",
    caption: cards[i]?.caption ?? "",
    detail: detail ?? (count > 0 ? `${i + 1} / ${count}` : ""),
  };
}

/**
 * Feedback payload for a message instead of cards (e.g. "Not playing from queue"). An optional
 * image is drawn as a single dimmed card above the text so the strip does not look empty.
 */
export function messageFeedback(context, { caption, detail = "", image }) {
  activeContexts.add(context);
  const cards = image ? drawCards(context, { cards: [{ image }], index: 0, dim: true }) : null;
  return { cards: cards ?? "", caption, detail };
}

export function forgetContext(context) {
  activeContexts.delete(context);
  clearCarousel(context);
}
