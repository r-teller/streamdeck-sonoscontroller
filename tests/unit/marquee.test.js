import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  MARQUEE_WIDTH,
  buildMarqueeRenderIntent,
  computeMarqueeWindow,
  ensureAlbumArtCached,
  _resetAlbumArtCache,
  _getAlbumArtCache,
} from "@/modules/plugin/marquee.js";

describe("marquee — computeMarqueeWindow (etr.8)", () => {
  it("text shorter than width returns whole string and resets nextPos", () => {
    expect(computeMarqueeWindow("abc", 0, 10)).toEqual({ window: "abc", nextPos: 0 });
  });

  it("text equal to width returns whole string", () => {
    expect(computeMarqueeWindow("0123456789", 0, 10).window).toBe("0123456789");
  });

  it("text longer than width slides one char per call", () => {
    const text = "abcdefghijkl"; // length 12, width 10
    const r0 = computeMarqueeWindow(text, 0, 10);
    expect(r0.window).toBe("abcdefghij");
    const r1 = computeMarqueeWindow(text, 1, 10);
    expect(r1.window).toBe("bcdefghijk");
    const r2 = computeMarqueeWindow(text, 2, 10);
    expect(r2.window).toBe("cdefghijkl");
  });

  it("AC: marquee wraps cleanly back to start after string + gap has scrolled", () => {
    const text = "abcdefghijkl"; // len 12, width 10, 4-char gap → wrapAt 16
    const positions = [];
    let pos = 0;
    for (let i = 0; i < 20; i++) {
      const r = computeMarqueeWindow(text, pos, 10);
      positions.push(r.window);
      pos = r.nextPos;
    }
    // First window matches the start.
    expect(positions[0]).toBe("abcdefghij");
    // After exactly (text.length + gap.length) = 16 advances, we wrap.
    expect(positions[16]).toBe("abcdefghij");
  });
});

describe("marquee — input source detection (etr.8 AC)", () => {
  beforeEach(() => _resetAlbumArtCache());

  it("AC: TV input — currentURI x-sonos-htastream:...:spdif → TV icon + 'TV' title (state-based)", () => {
    const settings = { displayStateBasedTitle: true };
    const speakerState = { currentURI: "x-sonos-htastream:RINCON_X:spdif" };
    const intent = buildMarqueeRenderIntent({
      inActionSettings: settings,
      inSonosSpeakerState: speakerState,
    });
    expect(intent.imageDataURL).toBe("./images/keys/input_tv.png");
    expect(intent.title).toBe("TV");
  });

  it("AC: Line-In — currentURI x-rincon-stream:... → line-in icon + 'Line In'", () => {
    const settings = { displayStateBasedTitle: true };
    const speakerState = { currentURI: "x-rincon-stream:RINCON_X" };
    const intent = buildMarqueeRenderIntent({
      inActionSettings: settings,
      inSonosSpeakerState: speakerState,
    });
    expect(intent.imageDataURL).toBe("./images/keys/input_line_in.png");
    expect(intent.title).toBe("Line In");
  });

  it("Queue branch: no static icon when not on TV / Line-In", () => {
    const intent = buildMarqueeRenderIntent({
      inActionSettings: {},
      inSonosSpeakerState: { currentURI: "x-rincon-queue:RINCON_X#0", playing: {} },
    });
    expect(intent.imageDataURL).toBe(null);
  });
});

describe("marquee — title rendering with toggles (etr.8 AC)", () => {
  beforeEach(() => _resetAlbumArtCache());

  it("AC: displayMarqueeTitle off → no title rendered", () => {
    const settings = { displayMarqueeTitle: false };
    const intent = buildMarqueeRenderIntent({
      inActionSettings: settings,
      inSonosSpeakerState: { playing: { title: "Some Track" } },
    });
    expect(intent.title).toBe(null);
    expect(intent.titleSource).toBe(null);
  });

  it("AC: displayMarqueeTitle on + short title → emits in full, no scroll", () => {
    const settings = { displayMarqueeTitle: true };
    const intent = buildMarqueeRenderIntent({
      inActionSettings: settings,
      inSonosSpeakerState: { playing: { title: "Short" } },
    });
    expect(intent.title).toBe("Short");
    expect(intent.titleSource).toBe("Short");
    expect(settings.marqueePositionTop).toBe(0);
  });

  it("AC: displayMarqueeTitle on + long title → window slides, position advances", () => {
    const settings = { displayMarqueeTitle: true };
    const speakerState = { playing: { title: "The Long And Winding Road" } };

    const a = buildMarqueeRenderIntent({
      inActionSettings: settings,
      inSonosSpeakerState: speakerState,
    });
    const b = buildMarqueeRenderIntent({
      inActionSettings: settings,
      inSonosSpeakerState: speakerState,
    });
    const c = buildMarqueeRenderIntent({
      inActionSettings: settings,
      inSonosSpeakerState: speakerState,
    });

    expect(a.title).toBe("The Long A");
    expect(b.title).toBe("he Long An");
    expect(c.title).toBe("e Long And");
    // titleSource is the underlying source string — stable across frames.
    expect(a.titleSource).toBe("The Long And Winding Road");
    expect(c.titleSource).toBe("The Long And Winding Road");
  });

  it("AC: displayMarqueeAlbumTitle on → album marquee joins the title with newline", () => {
    const settings = { displayMarqueeTitle: true, displayMarqueeAlbumTitle: true };
    const intent = buildMarqueeRenderIntent({
      inActionSettings: settings,
      inSonosSpeakerState: {
        playing: { title: "Track Name Goes Here", album: "Album Title Here" },
      },
    });
    expect(intent.title).toContain("\n");
    expect(intent.titleSource).toBe("Track Name Goes Here\nAlbum Title Here");
  });

  it("AC: track change → marqueePositionTop resets to 0", () => {
    const settings = { displayMarqueeTitle: true };

    // First track — advance scroll.
    for (let i = 0; i < 5; i++) {
      buildMarqueeRenderIntent({
        inActionSettings: settings,
        inSonosSpeakerState: {
          playing: { title: "First Long Track", albumArtURI: "art-1" },
        },
      });
    }
    expect(settings.marqueePositionTop).toBeGreaterThan(0);

    // New track (different albumArtURI) → resets.
    buildMarqueeRenderIntent({
      inActionSettings: settings,
      inSonosSpeakerState: {
        playing: { title: "Second Long Track", albumArtURI: "art-2" },
      },
    });
    // After reset, we got the first window of the new track and advanced once.
    expect(settings.marqueePositionTop).toBe(1);
    expect(settings.lastTrackArtURI).toBe("art-2");
  });
});

describe("marquee — album art fetch + cache (etr.8 AC)", () => {
  beforeEach(() => _resetAlbumArtCache());

  it("AC: local file path → passes through to imageDataURL without fetch", () => {
    const fetcher = vi.fn();
    const intent = buildMarqueeRenderIntent({
      inActionSettings: { displayAlbumArt: true },
      inSonosSpeakerState: {
        playing: { albumArtURI: "./images/keys/local.png" },
      },
      fetcher,
    });
    expect(intent.imageDataURL).toBe("./images/keys/local.png");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("AC: remote URL on first render → cache miss, returns null and kicks off fetch", () => {
    const fetcher = vi.fn(async () => "data:image/jpeg;base64,FAKE");
    const intent = buildMarqueeRenderIntent({
      inActionSettings: { displayAlbumArt: true },
      inSonosSpeakerState: {
        playing: { albumArtURI: "https://example.com/art.jpg" },
      },
      fetcher,
    });
    // Synchronous render returns null on cache miss; fetch is in-flight.
    expect(intent.imageDataURL).toBe(null);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("https://example.com/art.jpg");
  });

  it("AC: remote URL on second render after cache warm → hits cache, no re-fetch", async () => {
    const fetcher = vi.fn(async () => "data:image/jpeg;base64,WARM");
    await ensureAlbumArtCached("https://example.com/art2.jpg", fetcher);

    const intent = buildMarqueeRenderIntent({
      inActionSettings: { displayAlbumArt: true },
      inSonosSpeakerState: {
        playing: { albumArtURI: "https://example.com/art2.jpg" },
      },
      fetcher,
    });
    expect(intent.imageDataURL).toBe("data:image/jpeg;base64,WARM");
    // Initial warm + this render → still 1 fetch total.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("AC: displayAlbumArt off → no fetch even with a remote URI present", () => {
    const fetcher = vi.fn(async () => "data:img");
    const intent = buildMarqueeRenderIntent({
      inActionSettings: { displayAlbumArt: false },
      inSonosSpeakerState: {
        playing: { albumArtURI: "https://example.com/art.jpg" },
      },
      fetcher,
    });
    expect(intent.imageDataURL).toBe(null);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("ensureAlbumArtCached deduplicates concurrent in-flight fetches", async () => {
    let resolveFetch;
    const fetcher = vi.fn(
      () =>
        new Promise((r) => {
          resolveFetch = r;
        }),
    );
    const p1 = ensureAlbumArtCached("https://example.com/x.jpg", fetcher);
    const p2 = ensureAlbumArtCached("https://example.com/x.jpg", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    resolveFetch("data:img");
    await p1;
    expect(_getAlbumArtCache()["https://example.com/x.jpg"]).toBe("data:img");
    await p2; // returns null because second call saw fetch in-flight
  });
});

describe("marquee — defaults & non-goals (etr.8 AC)", () => {
  beforeEach(() => _resetAlbumArtCache());

  it("AC: all toggles off + Currently Playing → no title, no image", () => {
    const intent = buildMarqueeRenderIntent({
      inActionSettings: {
        displayStateBasedTitle: false,
        displayMarqueeTitle: false,
        displayMarqueeAlbumTitle: false,
        displayAlbumArt: false,
      },
      inSonosSpeakerState: {
        playing: { title: "Track", albumArtURI: "https://x.com/a.jpg" },
      },
    });
    expect(intent.title).toBe(null);
    expect(intent.imageDataURL).toBe(null);
  });

  it("AC: source field — uses playing.albumArtURI, not playing.albumArt (legacy bug)", () => {
    const settings = { displayAlbumArt: true };
    const fetcher = vi.fn(async () => "data:img");
    buildMarqueeRenderIntent({
      inActionSettings: settings,
      inSonosSpeakerState: {
        playing: { albumArt: "wrong-field-not-read", albumArtURI: "" },
      },
      fetcher,
    });
    // No fetch, no fallback — only albumArtURI is consulted.
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("MARQUEE_WIDTH constant exported (10)", () => {
    expect(MARQUEE_WIDTH).toBe(10);
  });
});
