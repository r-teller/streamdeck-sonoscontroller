// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parseClock,
  formatClock,
  positionSnapshot,
  trackTimeView,
  wantsTrackTime,
  trackTimeTicking,
} from "@/modules/plugin/trackTime.js";
import { composeKeyImage, _setKeyCanvasFactory, _resetKeyImages } from "@/modules/plugin/keyImage.js";
import { buildMarqueeRenderIntent } from "@/modules/plugin/marquee.js";
import { buildActionSettingsPayload } from "@/modules/pi/actionSettingsSchema.js";

const T0 = 1_000_000;
const playing = (extra = {}) => ({
  playbackState: "PLAYING",
  position: { elapsed: 83, duration: 225, at: T0 },
  ...extra,
});

describe("clock parsing and formatting", () => {
  it("parses Sonos times and rejects non-times", () => {
    expect(parseClock("0:04:45")).toBe(285);
    expect(parseClock("4:45")).toBe(285);
    expect(parseClock("1:02:03")).toBe(3723);
    expect(parseClock("")).toBeNull();
    expect(parseClock("NOT_IMPLEMENTED")).toBeNull();
    expect(parseClock(undefined)).toBeNull();
  });
  it("formats m:ss and h:mm:ss", () => {
    expect(formatClock(142)).toBe("2:22");
    expect(formatClock(5)).toBe("0:05");
    expect(formatClock(3723)).toBe("1:02:03");
    expect(formatClock(-3)).toBe("0:00");
  });
});

describe("position snapshot from GetPositionInfo", () => {
  it("records elapsed, length and when", () => {
    expect(positionSnapshot({ relTime: "0:01:23", trackDuration: "0:03:45" }, T0)).toEqual({
      elapsed: 83,
      duration: 225,
      at: T0,
    });
  });
  it("radio: no length", () => {
    expect(positionSnapshot({ relTime: "0:12:04", trackDuration: "0:00:00" }, T0)).toMatchObject({ duration: null });
    expect(positionSnapshot({ relTime: "0:12:04", trackDuration: "" }, T0)).toMatchObject({ duration: null });
  });
  it("no position (TV, line-in, NOT_IMPLEMENTED)", () => {
    expect(positionSnapshot({ relTime: "NOT_IMPLEMENTED" }, T0)).toBeNull();
    expect(positionSnapshot({}, T0)).toBeNull();
  });
});

describe("trackTimeView", () => {
  it("remaining time and bar fraction at the poll", () => {
    expect(trackTimeView(playing(), T0)).toEqual({ text: "-2:22", fraction: 83 / 225 });
  });
  it("counts down between polls while playing", () => {
    expect(trackTimeView(playing(), T0 + 10_000).text).toBe("-2:12");
  });
  it("stays put while paused or stopped", () => {
    expect(trackTimeView(playing({ playbackState: "PAUSED_PLAYBACK" }), T0 + 10_000).text).toBe("-2:22");
    expect(trackTimeView(playing({ playbackState: "STOPPED" }), T0 + 10_000).text).toBe("-2:22");
  });
  it("never runs past the end of the track", () => {
    expect(trackTimeView(playing(), T0 + 600_000)).toEqual({ text: "-0:00", fraction: 1 });
  });
  it("radio: elapsed only, no bar", () => {
    const state = { playbackState: "PLAYING", position: { elapsed: 724, duration: null, at: T0 } };
    expect(trackTimeView(state, T0 + 1000)).toEqual({ text: "12:05", fraction: null });
  });
  it("nothing when the speaker reported no position", () => {
    expect(trackTimeView({ playbackState: "PLAYING" }, T0)).toBeNull();
    expect(trackTimeView({ playbackState: "PLAYING", position: null }, T0)).toBeNull();
  });
});

describe("track time setting", () => {
  it("is on unless turned off (older keys have no setting)", () => {
    expect(wantsTrackTime({})).toBe(true);
    expect(wantsTrackTime({ displayTrackTime: true })).toBe(true);
    expect(wantsTrackTime({ displayTrackTime: false })).toBe(false);
  });
  it("ticks only while playing, with album art and time on", () => {
    const s = { displayAlbumArt: true };
    expect(trackTimeTicking(s, playing())).toBe(true);
    expect(trackTimeTicking({ ...s, displayTrackTime: false }, playing())).toBe(false);
    expect(trackTimeTicking({ displayAlbumArt: false }, playing())).toBe(false);
    expect(trackTimeTicking(s, playing({ playbackState: "PAUSED_PLAYBACK" }))).toBe(false);
    expect(trackTimeTicking(s, { playbackState: "PLAYING" })).toBe(false);
  });
  it("PI payload: on by default for Currently Playing and Play/Pause, absent elsewhere", () => {
    const build = (action, overrides = {}) =>
      buildActionSettingsPayload({ action: `com.r-teller.sonoscontroller.${action}`, states: [], overrides }).displayTrackTime;
    expect(build("currently-playing")).toBe(true);
    expect(build("toggle-play-pause")).toBe(true);
    expect(build("currently-playing", { displayTrackTime: false })).toBe(false);
    expect(build("toggle-mute-unmute")).toBeNull();
  });
});

describe("drawing time onto the album art", () => {
  let drawn;
  beforeEach(() => {
    _resetKeyImages();
    drawn = [];
    // jsdom has no 2D canvas or image decoding: fake a decoded image and record draw calls.
    vi.stubGlobal(
      "Image",
      class {
        constructor() {
          this.complete = true;
          this.naturalWidth = 144;
        }
      },
    );
    _setKeyCanvasFactory(() => {
      const ctx = new Proxy(
        { createLinearGradient: () => ({ addColorStop() {} }) },
        {
          get: (t, k) => (k in t ? t[k] : (...args) => drawn.push([k, ...args])),
          set: (t, k, v) => ((t[k] = v), true),
        },
      );
      return { getContext: () => ctx, toDataURL: () => `data:image/png;base64,COMPOSED${drawn.length}` };
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _setKeyCanvasFactory(() => null);
    _resetKeyImages();
  });

  it("draws the art, the bar and the remaining time", () => {
    const url = composeKeyImage("data:image/jpeg;base64,ART", { text: "-2:22", fraction: 0.37 });
    expect(url).toMatch(/^data:image\/png;base64,COMPOSED/);
    expect(drawn.find((c) => c[0] === "drawImage")).toBeTruthy();
    expect(drawn.filter((c) => c[0] === "fillRect").length).toBeGreaterThanOrEqual(3); // fade, track, fill
    expect(drawn.find((c) => c[0] === "fillText")?.[1]).toBe("-2:22");
  });
  it("radio: time without a bar", () => {
    composeKeyImage("data:image/jpeg;base64,ART", { text: "12:04", fraction: null });
    expect(drawn.filter((c) => c[0] === "fillRect")).toHaveLength(1); // fade only
  });
  it("the same second is drawn once", () => {
    const a = composeKeyImage("data:image/jpeg;base64,ART", { text: "-2:22", fraction: 0.37 });
    const n = drawn.length;
    expect(composeKeyImage("data:image/jpeg;base64,ART", { text: "-2:22", fraction: 0.37 })).toBe(a);
    expect(drawn.length).toBe(n);
  });
  it("heart badge alone: a dark dot in the top-right corner, no fade or bar", () => {
    composeKeyImage("data:image/jpeg;base64,ART", { badge: true });
    const arc = drawn.find((c) => c[0] === "arc");
    expect(arc?.[1]).toBeGreaterThan(100); // right side of the 144 px key
    expect(arc?.[2]).toBeLessThan(40); // top
    expect(drawn.filter((c) => c[0] === "fillRect")).toHaveLength(0);
  });
  it("time and badge together, cached separately from time alone", () => {
    const both = composeKeyImage("data:image/jpeg;base64,ART", { text: "-2:22", fraction: 0.37, badge: true });
    const timeOnly = composeKeyImage("data:image/jpeg;base64,ART", { text: "-2:22", fraction: 0.37 });
    expect(both).not.toBe(timeOnly);
  });
  it("Currently Playing draws the heart only for a song in the playlist, with the setting on", () => {
    const art = "data:image/jpeg;base64,ART";
    const render = (inFavorites, extra = {}) =>
      buildMarqueeRenderIntent({
        inActionSettings: { displayAlbumArt: true, displayTrackTime: false, ...extra },
        inSonosSpeakerState: { inFavorites, playing: { albumArtURI: art } },
      }).imageDataURL;
    expect(render(true)).toMatch(/COMPOSED/);
    expect(render(false)).toBe(art);
    expect(render(true, { displayFavoriteBadge: false })).toBe(art);
  });
  it("returns the plain art when no canvas is available", () => {
    _setKeyCanvasFactory(() => null);
    expect(composeKeyImage("data:image/jpeg;base64,ART", { text: "-2:22", fraction: 0.37 })).toBe("data:image/jpeg;base64,ART");
  });
});

describe("Currently Playing render intent with track time", () => {
  afterEach(() => vi.useRealTimers());
  const settings = (extra = {}) => ({
    displayAlbumArt: true,
    displayMarqueeTitle: true,
    displayMarqueeAlbumTitle: true,
    ...extra,
  });
  const state = {
    playbackState: "PLAYING",
    position: { elapsed: 83, duration: 225, at: Date.now() },
    playing: { title: "Luther", album: "GNX", albumArtURI: "data:image/jpeg;base64,ART" },
  };

  it("moves the album line up when time is shown", () => {
    const intent = buildMarqueeRenderIntent({ inActionSettings: settings(), inSonosSpeakerState: state });
    expect(intent.timeShown).toBe(true);
    expect(intent.title).toBe("Luther\nGNX");
  });
  it("time off: album stays on the bottom row and the art is unchanged", () => {
    const intent = buildMarqueeRenderIntent({
      inActionSettings: settings({ displayTrackTime: false }),
      inSonosSpeakerState: state,
    });
    expect(intent.timeShown).toBe(false);
    expect(intent.title).toBe("Luther\n\n\nGNX");
    expect(intent.imageDataURL).toBe("data:image/jpeg;base64,ART");
  });
  it("no album art: no time", () => {
    const intent = buildMarqueeRenderIntent({
      inActionSettings: settings({ displayAlbumArt: false }),
      inSonosSpeakerState: state,
    });
    expect(intent.timeShown).toBe(false);
  });
});
