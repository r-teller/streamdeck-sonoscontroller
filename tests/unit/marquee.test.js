import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MARQUEE_WIDTH,
  computeMarqueeWindow,
  detectInputSource,
  ensureAlbumArtCached,
  albumArtImage,
  buildMarqueeRenderIntent,
  _resetAlbumArtCache,
  _getAlbumArtCache,
} from "@/modules/plugin/marquee.js";

let resolveFetch;
let rejectFetch;

beforeEach(() => {
  _resetAlbumArtCache();
  resolveFetch = null;
  rejectFetch = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      return new Promise((res, rej) => {
        resolveFetch = res;
        rejectFetch = rej;
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("computeMarqueeWindow", () => {
  test("returns whole text when shorter than width", () => {
    const { window, nextPos } = computeMarqueeWindow("short", 0, MARQUEE_WIDTH);
    expect(window).toBe("short");
    expect(nextPos).toBe(0);
  });

  test("returns whole text when length equals width", () => {
    const txt = "ABCDEFGH"; // exactly MARQUEE_WIDTH chars
    expect(txt).toHaveLength(MARQUEE_WIDTH);
    const { window, nextPos } = computeMarqueeWindow(txt, 3, MARQUEE_WIDTH);
    expect(window).toBe(txt);
    expect(nextPos).toBe(0);
  });

  test("slides window for longer text and wraps correctly", () => {
    const txt = "HelloWorldX"; // 11 chars
    const width = 10; // explicit width: this exercises the window maths, not the key width
    // pos 0
    let res = computeMarqueeWindow(txt, 0, width);
    expect(res.window).toBe(txt.slice(0, width));
    // pos 1
    res = computeMarqueeWindow(txt, 1, width);
    expect(res.window).toBe(txt.slice(1, width + 1));
    // pos 9 (last char before gap)
    res = computeMarqueeWindow(txt, 9, width);
    // looped = txt + "    " + txt.slice(0,10)
    const looped = txt + "    " + txt.slice(0, width);
    expect(res.window).toBe(looped.slice(9, 19));
    // pos 14 (wrapLength -1) -> nextPos should be 0
    res = computeMarqueeWindow(txt, 14, width);
    expect(res.nextPos).toBe(0);
    // window at pos 14 includes part of gap and start of text
    expect(res.window).toBe(looped.slice(14, 24));
  });

  test("empty or falsy text returns empty window", () => {
    expect(computeMarqueeWindow("", 0, MARQUEE_WIDTH)).toEqual({
      window: "",
      nextPos: 0,
    });
    expect(computeMarqueeWindow(null, 0, MARQUEE_WIDTH)).toEqual({
      window: "",
      nextPos: 0,
    });
    expect(computeMarqueeWindow(undefined, 0, MARQUEE_WIDTH)).toEqual({
      window: "",
      nextPos: 0,
    });
  });

  test("1‑character advance across successive calls", () => {
    const txt = "ABCDEFGHIJKL";
    const width = MARQUEE_WIDTH;
    const looped = txt + "    " + txt.slice(0, width);
    const wrapLength = txt.length + 4;
    let pos = 0;
    for (let i = 0; i < wrapLength; i++) {
      const { window, nextPos } = computeMarqueeWindow(txt, pos, width);
      expect(window).toBe(looped.slice(pos % wrapLength, (pos % wrapLength) + width));
      pos = nextPos;
    }
  });
});

test("MARQUEE_WIDTH is what fits across a key in the bold title font (sonos-06p)", () => {
  expect(MARQUEE_WIDTH).toBe(8);
});

describe("detectInputSource", () => {
  test("detects TV source", () => {
    expect(detectInputSource("x-sonos-htastream:RINCON_X:spdif")).toBe("TV");
  });

  test("detects LINE_IN source", () => {
    expect(detectInputSource("x-rincon-stream:RINCON_X")).toBe("LINE_IN");
  });

  test("defaults to QUEUE for other URIs", () => {
    expect(detectInputSource("x-rincon-queue:RINCON_X#0")).toBe("QUEUE");
    expect(detectInputSource("")).toBe("QUEUE");
    expect(detectInputSource(undefined)).toBe("QUEUE");
  });
});

describe("ensureAlbumArtCached", () => {
  const url = "http://example.com/art.jpg";

  const successResponse = {
    ok: true,
    headers: { get: () => "image/jpeg" },
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  };

  test("miss triggers fetch and caches on success", async () => {
    const ret1 = ensureAlbumArtCached(url);
    expect(ret1).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(url, expect.objectContaining({ signal: expect.anything() }));
    // resolve fetch
    resolveFetch(successResponse);
    // flush microtasks
    for (let i = 0; i < 10; i += 1) await Promise.resolve();

    const cache = _getAlbumArtCache();
    expect(cache.get(url)).toBe("data:image/jpeg;base64,AQID");
    // second call hits cache
    const ret2 = ensureAlbumArtCached(url);
    expect(ret2).toBe("data:image/jpeg;base64,AQID");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("concurrent calls dedupe fetch", async () => {
    const r1 = ensureAlbumArtCached(url);
    const r2 = ensureAlbumArtCached(url);
    expect(r1).toBeNull();
    expect(r2).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    resolveFetch(successResponse);
    for (let i = 0; i < 10; i += 1) await Promise.resolve();

    const cache = _getAlbumArtCache();
    expect(cache.get(url)).toBe("data:image/jpeg;base64,AQID");
  });

  test("fetch error does not cache", async () => {
    const ret = ensureAlbumArtCached(url);
    expect(ret).toBeNull();
    rejectFetch(new Error("network"));
    for (let i = 0; i < 10; i += 1) await Promise.resolve();

    const cache = _getAlbumArtCache();
    expect(cache.has(url)).toBe(false);
    // subsequent call should try fetch again
    ensureAlbumArtCached(url);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  test("albumArtImage: undefined while downloading, data once cached, null on no art (sonos-p93)", async () => {
    expect(albumArtImage(url)).toBeUndefined(); // in flight: keep the key's current image
    expect(albumArtImage(url)).toBeUndefined();
    resolveFetch(successResponse);
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    expect(albumArtImage(url)).toBe("data:image/jpeg;base64,AQID");
    expect(albumArtImage(null)).toBeNull();
    expect(albumArtImage("")).toBeNull();
  });

  test("albumArtImage: a failed download falls back to the default image and retries later", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      expect(albumArtImage(url)).toBeUndefined();
      rejectFetch(new Error("network"));
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
      expect(albumArtImage(url)).toBeNull(); // not stuck on the previous track's art
      expect(fetch).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + 61_000);
      expect(albumArtImage(url)).toBeUndefined(); // retried
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a hung download is aborted so it can be retried", async () => {
    vi.useFakeTimers();
    try {
      ensureAlbumArtCached(url);
      const { signal } = fetch.mock.calls[0][1];
      expect(signal.aborted).toBe(false);
      vi.advanceTimersByTime(10_000);
      expect(signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  test("non‑http URLs pass through unchanged", () => {
    const local = "./images/keys/album.png";
    const ret = ensureAlbumArtCached(local);
    expect(ret).toBe(local);
    expect(fetch).not.toHaveBeenCalled();
    const cache = _getAlbumArtCache();
    expect(cache.size).toBe(0);
  });

  test("null/undefined returns null without fetch", () => {
    expect(ensureAlbumArtCached(null)).toBeNull();
    expect(ensureAlbumArtCached(undefined)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("buildMarqueeRenderIntent", () => {
  test("TV branch respects displayStateBasedTitle", () => {
    const state = { currentURI: "x-sonos-htastream:R:spdif" };
    const settingsOn = { displayStateBasedTitle: true };
    const intentOn = buildMarqueeRenderIntent({ inActionSettings: settingsOn, inSonosSpeakerState: state });
    expect(intentOn).toEqual({
      imageDataURL: "./images/keys/input_tv.png",
      title: "TV",
      titleSource: "TV",
    });

    const settingsOff = { displayStateBasedTitle: false };
    const intentOff = buildMarqueeRenderIntent({ inActionSettings: settingsOff, inSonosSpeakerState: state });
    expect(intentOff.title).toBeNull();
    expect(intentOff.titleSource).toBe("TV");
  });

  test("LINE_IN branch respects displayStateBasedTitle", () => {
    const state = { currentURI: "x-rincon-stream:R" };
    const settingsOn = { displayStateBasedTitle: true };
    const intentOn = buildMarqueeRenderIntent({ inActionSettings: settingsOn, inSonosSpeakerState: state });
    expect(intentOn).toEqual({
      imageDataURL: "./images/keys/input_line_in.png",
      title: "Line In",
      titleSource: "Line In",
    });

    const settingsOff = { displayStateBasedTitle: false };
    const intentOff = buildMarqueeRenderIntent({ inActionSettings: settingsOff, inSonosSpeakerState: state });
    expect(intentOff.title).toBeNull();
    expect(intentOff.titleSource).toBe("Line In");
  });

  test("QUEUE branch: title on the top row, album on the bottom row; only ticks advance (sonos-9at)", () => {
    const settings = { displayMarqueeTitle: true, displayMarqueeAlbumTitle: true, displayAlbumArt: false };
    const state = {
      currentURI: "x-rincon-queue:R#0",
      playing: { title: "A Very Long Song Title", album: "A Very Long Album Name", albumArtURI: "http://h/art.jpg" },
    };
    const win = (text, p) => computeMarqueeWindow(text, p, MARQUEE_WIDTH).window;
    const render = (advanceMarquee) =>
      buildMarqueeRenderIntent({ inActionSettings: settings, inSonosSpeakerState: state, advanceMarquee });

    const first = render(false);
    expect(first.title).toBe(`${win(state.playing.title, 0)}\n\n\n${win(state.playing.album, 0)}`);
    expect(first.titleSource).toBe(`${state.playing.title}\n${state.playing.album}`);
    expect(first.imageDataURL).toBeNull();

    // a poll/action redraw does not move the text
    expect(render(false).title).toBe(first.title);
    // a ticker frame moves both lines one character
    expect(render(true).title).toBe(`${win(state.playing.title, 1)}\n\n\n${win(state.playing.album, 1)}`);
    expect(render(false).title).toBe(`${win(state.playing.title, 1)}\n\n\n${win(state.playing.album, 1)}`);
  });

  test("album-only marquee sits on the bottom row; title-only on the top row", () => {
    const state = {
      currentURI: "x-rincon-queue:R#0",
      playing: { title: "Big Poppa", album: "Ready to Die", albumArtURI: "http://h/a.jpg" },
    };
    const albumOnly = buildMarqueeRenderIntent({
      inActionSettings: { displayMarqueeAlbumTitle: true },
      inSonosSpeakerState: state,
    });
    expect(albumOnly.title).toBe(`\n\n\n${computeMarqueeWindow("Ready to Die", 0, MARQUEE_WIDTH).window}`);
    const titleOnly = buildMarqueeRenderIntent({ inActionSettings: { displayMarqueeTitle: true }, inSonosSpeakerState: state });
    expect(titleOnly.title).toBe(computeMarqueeWindow("Big Poppa", 0, MARQUEE_WIDTH).window);
  });

  test("track change resets marquee positions", () => {
    const settings = {
      displayMarqueeTitle: true,
      displayMarqueeAlbumTitle: true,
      displayAlbumArt: false,
      marqueePositionTop: 5,
      marqueePositionBottom: 7,
      lastTrackArtURI: "http://h/old.jpg",
    };
    const playing = (title, album, art) => ({ currentURI: "x-rincon-queue:R#0", playing: { title, album, albumArtURI: art } });

    buildMarqueeRenderIntent({ inActionSettings: settings, inSonosSpeakerState: playing("First Title", "First Album", "http://h/old.jpg"), advanceMarquee: true });
    expect(settings.marqueePositionTop).toBe(6);
    expect(settings.marqueePositionBottom).toBe(8);

    const intent = buildMarqueeRenderIntent({
      inActionSettings: settings,
      inSonosSpeakerState: playing("Second Title", "Second Album", "http://h/new.jpg"),
    });
    expect(settings.marqueePositionTop).toBe(0);
    expect(settings.marqueePositionBottom).toBe(0);
    expect(settings.lastTrackArtURI).toBe("http://h/new.jpg");
    expect(intent.title).toBe(
      `${computeMarqueeWindow("Second Title", 0, MARQUEE_WIDTH).window}\n\n\n${computeMarqueeWindow("Second Album", 0, MARQUEE_WIDTH).window}`,
    );
  });
});
