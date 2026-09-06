import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MARQUEE_WIDTH,
  computeMarqueeWindow,
  detectInputSource,
  ensureAlbumArtCached,
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
    const txt = "ABCDEFGHIJ"; // 10 chars
    const { window, nextPos } = computeMarqueeWindow(txt, 3, MARQUEE_WIDTH);
    expect(window).toBe(txt);
    expect(nextPos).toBe(0);
  });

  test("slides window for longer text and wraps correctly", () => {
    const txt = "HelloWorldX"; // 11 chars
    const width = MARQUEE_WIDTH; // 10
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
    expect(fetch).toHaveBeenCalledWith(url);
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

  test("QUEUE branch renders marquee and advances cursors", () => {
    const settings = {
      displayMarqueeTitle: true,
      displayMarqueeAlbumTitle: true,
      displayAlbumArt: false,
      marqueePositionTop: 0,
      marqueePositionBottom: 0,
    };
    const state = {
      currentURI: "x-rincon-queue:R#0",
      playing: {
        title: "A Very Long Song Title",
        album: "A Very Long Album Name",
        albumArtURI: "http://h/art.jpg",
      },
    };

    // first render
    const intent1 = buildMarqueeRenderIntent({ inActionSettings: settings, inSonosSpeakerState: state });
    const expectedTop1 = computeMarqueeWindow(state.playing.title, 0, MARQUEE_WIDTH).window;
    const expectedBottom1 = computeMarqueeWindow(state.playing.album, 0, MARQUEE_WIDTH).window;
    expect(intent1.title).toBe(`${expectedTop1}\n${expectedBottom1}`);
    expect(intent1.titleSource).toBe(`${state.playing.title}\n${state.playing.album}`);
    expect(intent1.imageDataURL).toBeNull();

    // positions should have advanced by 1
    expect(settings.marqueePositionTop).toBe(1);
    expect(settings.marqueePositionBottom).toBe(1);

    // second render – windows shifted by one character
    const intent2 = buildMarqueeRenderIntent({ inActionSettings: settings, inSonosSpeakerState: state });
    const expectedTop2 = computeMarqueeWindow(state.playing.title, 1, MARQUEE_WIDTH).window;
    const expectedBottom2 = computeMarqueeWindow(state.playing.album, 1, MARQUEE_WIDTH).window;
    expect(intent2.title).toBe(`${expectedTop2}\n${expectedBottom2}`);
    expect(settings.marqueePositionTop).toBe(2);
    expect(settings.marqueePositionBottom).toBe(2);
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
    const state1 = {
      currentURI: "x-rincon-queue:R#0",
      playing: {
        title: "First Title",
        album: "First Album",
        albumArtURI: "http://h/old.jpg",
      },
    };
    // first call – no change, positions stay as they are (function only resets on change)
    buildMarqueeRenderIntent({ inActionSettings: settings, inSonosSpeakerState: state1 });
    expect(settings.marqueePositionTop).toBe(6);
    expect(settings.marqueePositionBottom).toBe(8);
    expect(settings.lastTrackArtURI).toBe("http://h/old.jpg");

    // change albumArtURI
    const state2 = {
      currentURI: "x-rincon-queue:R#0",
      playing: {
        title: "Second Title",
        album: "Second Album",
        albumArtURI: "http://h/new.jpg",
      },
    };
    buildMarqueeRenderIntent({ inActionSettings: settings, inSonosSpeakerState: state2 });
    // positions were reset to 0 for this render, then advanced to 1
    expect(settings.marqueePositionTop).toBe(1);
    expect(settings.marqueePositionBottom).toBe(1);
    expect(settings.lastTrackArtURI).toBe("http://h/new.jpg");

    // subsequent call advances from 1 (same URI → no reset)
    const intent = buildMarqueeRenderIntent({ inActionSettings: settings, inSonosSpeakerState: state2 });
    const expectedTop = computeMarqueeWindow(state2.playing.title, 1, MARQUEE_WIDTH).window;
    const expectedBottom = computeMarqueeWindow(state2.playing.album, 1, MARQUEE_WIDTH).window;
    expect(intent.title).toBe(`${expectedTop}\n${expectedBottom}`);
    expect(settings.marqueePositionTop).toBe(2);
    expect(settings.marqueePositionBottom).toBe(2);
  });
});
