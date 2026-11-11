// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CARDS_WIDTH,
  CARDS_HEIGHT,
  SIDE_BUFFER,
  ANIMATION_FRAMES,
  ANIMATION_FRAME_MS,
  wrapIndex,
  cardPlacements,
  browseTick,
  pendingTicks,
  slideOffset,
  slideNext,
  endBrowse,
  setCarouselRenderHook,
  carouselFeedback,
  messageFeedback,
  forgetContext,
  _resetCarousels,
  _setCanvasFactory,
} from "@/modules/plugin/carousel.js";
import { handleDialRotate, _resetDialRotateState, DIAL_DEBOUNCE_MS } from "@/modules/plugin/dialRotateDebouncer.js";

/** Minimal 2D canvas stand-in that records what was drawn. */
function stubCanvas() {
  const calls = [];
  const ctx = new Proxy(
    { calls },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        return (...args) => calls.push([prop, ...args]);
      },
      set(target, prop, value) {
        calls.push([`set:${String(prop)}`, value]);
        return true;
      },
    },
  );
  return { width: 0, height: 0, getContext: () => ctx, toDataURL: () => "data:image/png;base64,STUB", calls };
}

describe("carousel geometry", () => {
  it("wraps indexes both ways", () => {
    expect(wrapIndex(5, 5)).toBe(0);
    expect(wrapIndex(-1, 5)).toBe(4);
    expect(wrapIndex(-6, 5)).toBe(4);
    expect(wrapIndex(3, 0)).toBe(0);
  });

  it("at rest: centre card large in the middle, two smaller, darker cards per side (option B)", () => {
    const p = cardPlacements({ count: 10, index: 4 });
    expect(p.map((c) => c.item).sort((a, b) => a - b)).toEqual([2, 3, 4, 5, 6]);
    const at = (item) => p.find((c) => c.item === item);
    const center = at(4);
    expect(center.center).toBe(true);
    expect(center.x + center.size / 2).toBe(CARDS_WIDTH / 2);
    expect(center.size).toBeGreaterThan(at(3).size);
    expect(at(3).size).toBeGreaterThan(at(2).size);
    expect(at(3).shade).toBeLessThan(1);
    expect(at(2).shade).toBeLessThan(at(3).shade);
    for (const c of p) expect(c.y + c.size).toBeLessThanOrEqual(CARDS_HEIGHT);
    // outer cards drawn first, centre card last so it is on top
    expect(p.at(-1).center).toBe(true);
    expect(p[0].distance).toBe(2);
  });

  it("neighbours overlap the centre card a little", () => {
    const p = cardPlacements({ count: 10, index: 4 });
    const center = p.find((c) => c.center);
    const left = p.find((c) => c.item === 3);
    const right = p.find((c) => c.item === 5);
    for (const overlap of [left.x + left.size - center.x, center.x + center.size - right.x]) {
      expect(overlap).toBeGreaterThan(5);
      expect(overlap).toBeLessThan(15);
    }
  });

  it("at rest every card fits whole inside the side buffer", () => {
    for (const count of [1, 2, 3, 4, 5, 12]) {
      for (const c of cardPlacements({ count, index: 0 })) {
        expect(c.x).toBeGreaterThanOrEqual(SIDE_BUFFER);
        expect(c.x + c.size).toBeLessThanOrEqual(CARDS_WIDTH - SIDE_BUFFER);
      }
    }
  });

  it("neighbours wrap around the list", () => {
    const items = cardPlacements({ count: 6, index: 0 }).map((c) => c.item);
    expect(items).toContain(5);
    expect(items).toContain(1);
  });

  it("small lists never show the same card twice", () => {
    const items = (count) =>
      cardPlacements({ count, index: 0 })
        .map((c) => c.item)
        .sort((a, b) => a - b);
    expect(items(1)).toEqual([0]);
    expect(items(2)).toEqual([0, 1]);
    expect(items(3)).toEqual([0, 1, 2]);
    expect(items(4)).toEqual([0, 1, 3]);
    expect(items(5)).toEqual([0, 1, 2, 3, 4]);
    expect(cardPlacements({ count: 0, index: 0 })).toEqual([]);
  });

  it("slide offsets move every card the same way and shrink the centre card", () => {
    const rest = cardPlacements({ count: 10, index: 4 }).find((c) => c.center);
    const right = cardPlacements({ count: 10, index: 4, offset: 0.5 }).find((c) => c.center);
    const left = cardPlacements({ count: 10, index: 4, offset: -0.5 }).find((c) => c.center);
    expect(right.x + right.size / 2).toBeGreaterThan(rest.x + rest.size / 2);
    expect(left.x + left.size / 2).toBeLessThan(rest.x + rest.size / 2);
    expect(right.size).toBeLessThan(rest.size);
  });
});

describe("browse state and slide animation", () => {
  let renders;
  beforeEach(() => {
    vi.useFakeTimers();
    _resetCarousels();
    renders = [];
    setCarouselRenderHook((context) => renders.push([context, slideOffset(context)]));
  });
  afterEach(() => {
    _resetCarousels();
    setCarouselRenderHook(null);
    vi.useRealTimers();
  });

  it("a step right slides in from the right and comes to rest", () => {
    browseTick("c1", 1);
    expect(pendingTicks("c1")).toBe(1);
    vi.advanceTimersByTime(ANIMATION_FRAME_MS * ANIMATION_FRAMES.length);
    expect(renders.map(([, o]) => o)).toEqual(ANIMATION_FRAMES.map((f) => 1 * f));
    expect(slideOffset("c1")).toBe(0);
  });

  it("a step left slides the other way", () => {
    browseTick("c1", -1);
    vi.runAllTimers();
    expect(renders[0][1]).toBeLessThan(0);
    expect(pendingTicks("c1")).toBe(-1);
  });

  it("a fast spin does not queue frames: it restarts the slide toward the latest card", () => {
    for (let i = 0; i < 6; i++) browseTick("c1", 1);
    expect(pendingTicks("c1")).toBe(6);
    vi.runAllTimers();
    // 6 immediate first frames + the remaining frames of the last slide only
    expect(renders.length).toBe(6 + ANIMATION_FRAMES.length - 1);
    expect(slideOffset("c1")).toBe(0);
  });

  it("endBrowse keeps ticks turned while the speaker call was in flight", () => {
    browseTick("c1", 2);
    browseTick("c1", 1); // arrives during the call that applies the first 2
    endBrowse("c1", 2);
    expect(pendingTicks("c1")).toBe(1);
    endBrowse("c1");
    expect(pendingTicks("c1")).toBe(0);
  });

  it("slideNext animates without changing the browse offset", () => {
    slideNext("c1");
    vi.runAllTimers();
    expect(pendingTicks("c1")).toBe(0);
    expect(renders.length).toBe(ANIMATION_FRAMES.length);
  });

  it("forgetContext stops a running slide", () => {
    browseTick("c1", 1);
    forgetContext("c1");
    vi.runAllTimers();
    expect(renders.length).toBe(1);
    expect(pendingTicks("c1")).toBe(0);
  });
});

describe("carousel feedback", () => {
  afterEach(() => _setCanvasFactory(() => null));

  it("draws the cards image and fills caption and position", () => {
    const canvas = stubCanvas();
    _setCanvasFactory(() => canvas);
    const cards = [{ caption: "One" }, { caption: "Two" }, { caption: "Three" }, { caption: "Four" }];
    const fb = carouselFeedback("c1", { cards, index: 5 });
    expect(fb).toEqual({ cards: "data:image/png;base64,STUB", caption: "Two", detail: "2 / 4" });
    expect(canvas.width).toBe(CARDS_WIDTH);
    expect(canvas.height).toBe(CARDS_HEIGHT);
    // missing art: placeholder glyph drawn for each visible card
    expect(canvas.calls.filter(([op]) => op === "fillText").length).toBeGreaterThanOrEqual(3);
  });

  it("uses a custom detail line when given", () => {
    _setCanvasFactory(() => stubCanvas());
    expect(carouselFeedback("c1", { cards: [{ caption: "Normal" }], index: 0, detail: "Play mode" }).detail).toBe("Play mode");
  });

  it("without a canvas it still sends caption and position", () => {
    _setCanvasFactory(() => null);
    expect(carouselFeedback("c1", { cards: [{ caption: "A" }], index: 0 })).toEqual({
      cards: "",
      caption: "A",
      detail: "1 / 1",
    });
  });

  it("message card: no cards, just the text", () => {
    expect(messageFeedback("c1", { caption: "Not playing from queue" })).toEqual({
      cards: "",
      caption: "Not playing from queue",
      detail: "",
    });
  });

  it("message card with an image draws one dimmed card above the text", () => {
    const canvas = stubCanvas();
    _setCanvasFactory(() => canvas);
    const fb = messageFeedback("c1", { caption: "Queue is empty", image: "images/keys/x.png" });
    expect(fb).toEqual({ cards: "data:image/png;base64,STUB", caption: "Queue is empty", detail: "" });
    // dimmed with a dark overlay on the (opaque) card, and no highlight border
    const overlays = canvas.calls.filter(([op, v]) => op === "set:fillStyle" && /^rgba\(0,0,0,/.test(v));
    expect(overlays).toHaveLength(1);
    expect(Number(overlays[0][1].match(/,([\d.]+)\)$/)[1])).toBeGreaterThan(0.5);
    expect(canvas.calls.filter(([op]) => op === "stroke")).toHaveLength(0);
  });

  it("clips drawing to the side buffer", () => {
    const canvas = stubCanvas();
    _setCanvasFactory(() => canvas);
    carouselFeedback("c1", { cards: [{}, {}, {}, {}, {}], index: 0 });
    const rect = canvas.calls.find(([op]) => op === "rect");
    expect(rect).toEqual(["rect", SIDE_BUFFER, 0, CARDS_WIDTH - 2 * SIDE_BUFFER, CARDS_HEIGHT]);
  });

  it("feedback keys match the carousel layout", () => {
    const layout = JSON.parse(readFileSync(resolve(process.cwd(), "public/layouts/encoder-carousel.json"), "utf8"));
    const keys = layout.items.map((i) => i.key).sort();
    expect(Object.keys(messageFeedback("c1", { caption: "x" })).sort()).toEqual(keys);
    const cardsItem = layout.items.find((i) => i.key === "cards");
    expect(cardsItem.rect).toEqual([0, 0, CARDS_WIDTH, CARDS_HEIGHT]);
  });
});

describe("dial rotate debouncer options", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    _resetDialRotateState();
    vi.useRealTimers();
  });

  it("calls onTick on every tick and dispatches the net after the per-dial settle time", () => {
    const dispatch = vi.fn();
    const ticks = [];
    for (const t of [1, 1, -1]) {
      handleDialRotate({ context: "c", ticks: t, dispatch, settleMs: 1000, onTick: (n) => ticks.push(n) });
    }
    expect(ticks).toEqual([1, 1, -1]);
    vi.advanceTimersByTime(DIAL_DEBOUNCE_MS + 10);
    expect(dispatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(dispatch).toHaveBeenCalledWith({ inContext: "c", inEvent: "dialRotate", inRotation: 1 });
  });

  it("defaults to the standard debounce", () => {
    const dispatch = vi.fn();
    handleDialRotate({ context: "c", ticks: 2, dispatch });
    vi.advanceTimersByTime(DIAL_DEBOUNCE_MS);
    expect(dispatch).toHaveBeenCalledWith({ inContext: "c", inEvent: "dialRotate", inRotation: 2 });
  });
});
