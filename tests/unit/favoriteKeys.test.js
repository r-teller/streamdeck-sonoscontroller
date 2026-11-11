// Play Sonos Favorite redesign (sonos-gw5) + marquee ticker (sonos-8lu) + album art (sonos-clg).
// Scenario mirrors the real setup: Office speaker, Kendrick Lamar Mix (top right) and Today's Top Hits (bottom right).
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

import {
  migrateFavoriteSettings,
  needsFavoriteMigration,
  isFavoriteActive,
  isQueueFavorite,
  truncateLine,
} from "@/modules/common/favoriteSettings.js";
import { buildFavoriteRenderIntent, syncFavoriteKeys } from "@/modules/plugin/favoriteKeys.js";
import { startRenderTicker, wantsMarquee } from "@/modules/plugin/renderTicker.js";
import { startPollingSupervisor } from "@/modules/plugin/pollingSupervisor.js";
import { getAllSpeakers, addContext, getSpeaker, updateSpeakerState } from "@/modules/plugin/SonosSpeakers.js";
import { actionSettings, setActionSettings } from "@/modules/plugin/actionSettings.js";
import { _resetAlbumArtCache, _getAlbumArtCache } from "@/modules/plugin/marquee.js";
import { SonosController } from "@/modules/common/sonosController.js";

const SPK = "RINCON_OFFICENEW01400";
const FAV = "com.r-teller.sonoscontroller.play-sonos-favorite";
const KENDRICK = {
  title: "Kendrick Lamar Mix",
  uri: "x-rincon-cpcontainer:1006206cspotify%3aplaylist%3a37i9dQZF1EXAMPLEMIX001?sid=12",
  albumArtURI: "https://pickasso.spotifycdn.com/kendrick",
};
const TOPHITS = {
  title: "Today's Top Hits",
  uri: "x-rincon-cpcontainer:1006206cspotify%3aplaylist%3a37i9dQZF1DXcBWIGoYBM5M?sid=12",
  albumArtURI: "https://i.scdn.co/tophits",
};
const RADIO = { title: "Jazz FM", uri: "x-sonosapi-stream:s123?sid=254", albumArtURI: "https://art/jazz" };
const SIG_K = { updateId: "4", total: 100, firstTrackUri: "x-sonos-spotify:luther" };
const SIG_T = { updateId: "6", total: 50, firstTrackUri: "x-sonos-spotify:tophit1" };
const QUEUE = `x-rincon-queue:${SPK}#0`;

const allOn = {
  displayFavoriteName: true,
  displayTrackTitle: true,
  displayMarquee: true,
  displayFavoriteArtwork: true,
  displayTrackArtwork: true,
};
const key = (favorite, extra = {}) => ({ action: FAV, uuid: SPK, selectedSonosFavorite: favorite, ...allOn, ...extra });
const playingState = (sig, title = "luther (with sza)", art = "http://192.168.50.80:1400/getaa?luther") => ({
  playbackState: "PLAYING",
  mediaURI: QUEUE,
  queueSignature: sig,
  playing: { title, albumArtURI: art },
});

beforeEach(() => {
  const all = getAllSpeakers();
  for (const k of Object.keys(all)) delete all[k];
  for (const k of Object.keys(actionSettings)) delete actionSettings[k];
  _resetAlbumArtCache();
  // Pre-cache art so render intents return data URLs synchronously.
  const cache = _getAlbumArtCache();
  for (const u of [
    KENDRICK.albumArtURI,
    TOPHITS.albumArtURI,
    RADIO.albumArtURI,
    "http://192.168.50.80:1400/getaa?luther",
    "http://192.168.50.80:1400/getaa?hit",
  ]) {
    cache.set(u, `data:${u}`);
  }
});

describe("settings migration (agreed Q5)", () => {
  test("legacy album art + marquee map onto the new toggles", () => {
    expect(needsFavoriteMigration({ displayAlbumArt: true })).toBe(true);
    expect(migrateFavoriteSettings({ uuid: "x", displayAlbumArt: true, displayMarqueeTitle: true })).toEqual({
      uuid: "x",
      displayFavoriteName: true,
      displayTrackTitle: true,
      displayMarquee: true,
      displayFavoriteArtwork: true,
      displayTrackArtwork: true,
    });
    // Today's Top Hits: art on, marquee off -> track title stays off (not forced on)
    expect(migrateFavoriteSettings({ displayAlbumArt: true, displayMarqueeTitle: false })).toMatchObject({
      displayTrackTitle: false,
      displayMarquee: false,
      displayFavoriteArtwork: true,
      displayTrackArtwork: true,
    });
  });

  test("already-migrated settings are returned unchanged", () => {
    const s = key(KENDRICK);
    expect(migrateFavoriteSettings(s)).toBe(s);
  });
});

describe("active favorite", () => {
  test("queue favorite is active only while its signature matches", () => {
    expect(isQueueFavorite(KENDRICK)).toBe(true);
    expect(isFavoriteActive(key(KENDRICK, { favoriteSignature: SIG_K }), playingState(SIG_K))).toBe(true);
    expect(isFavoriteActive(key(KENDRICK, { favoriteSignature: SIG_K }), playingState(SIG_T))).toBe(false);
    expect(isFavoriteActive(key(KENDRICK), playingState(SIG_K))).toBe(false);
  });

  test("paused and stopped stay active (agreed Q2)", () => {
    for (const playbackState of ["PAUSED_PLAYBACK", "STOPPED"]) {
      expect(isFavoriteActive(key(KENDRICK, { favoriteSignature: SIG_K }), { ...playingState(SIG_K), playbackState })).toBe(
        true,
      );
    }
  });

  test("switching the speaker to TV deactivates the favorite", () => {
    const state = { ...playingState(SIG_K), mediaURI: `x-sonos-htastream:${SPK}:spdif` };
    expect(isFavoriteActive(key(KENDRICK, { favoriteSignature: SIG_K }), state)).toBe(false);
  });

  test("radio favorite matches by stream URI", () => {
    expect(isQueueFavorite(RADIO)).toBe(false);
    expect(isFavoriteActive(key(RADIO), { mediaURI: RADIO.uri })).toBe(true);
    expect(isFavoriteActive(key(RADIO), { mediaURI: QUEUE })).toBe(false);
  });
});

describe("rendering: Kendrick -> Top Hits (agreed reference case)", () => {
  test("only the active key shows the track; the other reverts to its favorite art", () => {
    const kendrick = key(KENDRICK, { favoriteSignature: SIG_K });
    const topHits = key(TOPHITS, { favoriteSignature: SIG_T });

    // Kendrick playing
    let state = playingState(SIG_K);
    let k = buildFavoriteRenderIntent({ inActionSettings: kendrick, inSonosSpeakerState: state });
    let t = buildFavoriteRenderIntent({ inActionSettings: topHits, inSonosSpeakerState: state });
    expect(k.title).toBe("Kendri…\n\n\nluther (");
    expect(k.imageDataURL).toBe("data:http://192.168.50.80:1400/getaa?luther");
    expect(t.title).toBe("Today'…");
    expect(t.imageDataURL).toBe(`data:${TOPHITS.albumArtURI}`);

    // Switch to Top Hits
    state = playingState(SIG_T, "Golden Hour Anthem", "http://192.168.50.80:1400/getaa?hit");
    k = buildFavoriteRenderIntent({ inActionSettings: kendrick, inSonosSpeakerState: state });
    t = buildFavoriteRenderIntent({ inActionSettings: topHits, inSonosSpeakerState: state });
    expect(k.title).toBe("Kendri…"); // 8 chars fit across a key (sonos-06p)
    expect(k.imageDataURL).toBe(`data:${KENDRICK.albumArtURI}`);
    expect(t.title).toBe("Today'…\n\n\nGolden H");
    expect(t.imageDataURL).toBe("data:http://192.168.50.80:1400/getaa?hit");
  });

  test("marquee scrolls only the active key's track; the name never scrolls (agreed Q4)", () => {
    const kendrick = key(KENDRICK, { favoriteSignature: SIG_K });
    const state = playingState(SIG_K);
    const render = (advanceMarquee) =>
      buildFavoriteRenderIntent({ inActionSettings: kendrick, inSonosSpeakerState: state, advanceMarquee }).title;
    // poll/action redraws repeat the frame; only ticker frames advance it (sonos-9at)
    const frames = [render(false), render(false), render(true), render(false), render(true)];
    expect(frames).toEqual([
      "Kendri…\n\n\nluther (",
      "Kendri…\n\n\nluther (",
      "Kendri…\n\n\nuther (w",
      "Kendri…\n\n\nuther (w",
      "Kendri…\n\n\nther (wi",
    ]);
    expect(wantsMarquee(kendrick, state)).toBe(true);
    expect(wantsMarquee(key(TOPHITS, { favoriteSignature: SIG_T }), state)).toBe(false);
  });

  test("artwork precedence and toggles off", () => {
    const state = playingState(SIG_K);
    const onlyFavArt = key(KENDRICK, { favoriteSignature: SIG_K, displayTrackArtwork: false });
    expect(buildFavoriteRenderIntent({ inActionSettings: onlyFavArt, inSonosSpeakerState: state }).imageDataURL).toBe(
      `data:${KENDRICK.albumArtURI}`,
    );
    const noArt = key(KENDRICK, { displayTrackArtwork: false, displayFavoriteArtwork: false });
    expect(buildFavoriteRenderIntent({ inActionSettings: noArt, inSonosSpeakerState: state }).imageDataURL).toBeNull();
    const noText = key(TOPHITS, { displayFavoriteName: false });
    expect(buildFavoriteRenderIntent({ inActionSettings: noText, inSonosSpeakerState: state }).title).toBeNull();
    expect(truncateLine("Short", 10)).toBe("Short");
  });
});

describe("syncFavoriteKeys: signature ownership", () => {
  const sd = () => ({ saveSettings: vi.fn() });

  test("keyDown ownership is written to identical keys and persisted without runtime fields (agreed Q3)", () => {
    setActionSettings("k1", { ...key(KENDRICK), status: { x: 1 } });
    setActionSettings("k2", key(KENDRICK)); // same favorite on another page
    setActionSettings("t1", key(TOPHITS, { favoriteSignature: SIG_T }));
    for (const c of ["k1", "k2", "t1"]) addContext({ UUID: SPK, context: c });
    updateSpeakerState({
      UUID: SPK,
      state: { ...playingState(SIG_K), loadedFavorite: { uri: KENDRICK.uri, signature: SIG_K } },
    });

    const client = sd();
    expect(syncFavoriteKeys({ UUID: SPK, sd: client }).sort()).toEqual(["k1", "k2"]);
    expect(actionSettings.k1.favoriteSignature).toMatchObject(SIG_K);
    expect(actionSettings.k2.favoriteSignature).toMatchObject({ ...SIG_K, speakerUuid: SPK });
    expect(actionSettings.t1.favoriteSignature).toEqual(SIG_T);
    const saved = client.saveSettings.mock.calls.find((c) => c[0].context === "k1")[0].actionSettings;
    expect(saved).not.toHaveProperty("status");
    // idempotent
    expect(syncFavoriteKeys({ UUID: SPK, sd: client })).toEqual([]);
  });

  test("after a restart a persisted signature re-establishes ownership and spreads to a copy (agreed Q1)", () => {
    setActionSettings("k1", key(KENDRICK, { favoriteSignature: { speakerUuid: SPK, ...SIG_K } }));
    setActionSettings("k2", key(KENDRICK));
    addContext({ UUID: SPK, context: "k1" });
    addContext({ UUID: SPK, context: "k2" });
    updateSpeakerState({ UUID: SPK, state: playingState(SIG_K) }); // no loadedFavorite after restart
    expect(syncFavoriteKeys({ UUID: SPK, sd: sd() })).toEqual(["k2"]);
    expect(isFavoriteActive(actionSettings.k2, getSpeaker({ UUID: SPK }).state)).toBe(true);
  });

  test("a queue still filling after keyDown keeps ownership and adopts the newer signature (sonos-dl6)", () => {
    setActionSettings("k1", key(KENDRICK));
    addContext({ UUID: SPK, context: "k1" });
    const atKeyDown = { ...SIG_K, updateId: "3", total: 40 }; // read while Sonos was still appending
    updateSpeakerState({
      UUID: SPK,
      state: { ...playingState(SIG_K), loadedFavorite: { uri: KENDRICK.uri, signature: atKeyDown } },
    });

    expect(syncFavoriteKeys({ UUID: SPK, sd: sd() })).toEqual(["k1"]);
    expect(actionSettings.k1.favoriteSignature).toMatchObject(SIG_K);
    expect(isFavoriteActive(actionSettings.k1, getSpeaker({ UUID: SPK }).state)).toBe(true);
    expect(getSpeaker({ UUID: SPK }).state.loadedFavorite.signature).toEqual(SIG_K);
  });

  test("a queue changed elsewhere (Sonos app) leaves every key inactive", () => {
    setActionSettings("k1", key(KENDRICK, { favoriteSignature: SIG_K }));
    addContext({ UUID: SPK, context: "k1" });
    updateSpeakerState({
      UUID: SPK,
      state: {
        ...playingState({ updateId: "9", total: 12, firstTrackUri: "other" }),
        loadedFavorite: { uri: KENDRICK.uri, signature: SIG_K },
      },
    });
    expect(syncFavoriteKeys({ UUID: SPK, sd: sd() })).toEqual([]);
    expect(isFavoriteActive(actionSettings.k1, getSpeaker({ UUID: SPK }).state)).toBe(false);
  });
});

describe("render ticker (sonos-8lu) and art redraw (sonos-clg)", () => {
  afterEach(() => vi.useRealTimers());

  test("re-renders only scrolling keys every tick, without polling", () => {
    vi.useFakeTimers();
    setActionSettings("k1", key(KENDRICK, { favoriteSignature: SIG_K }));
    setActionSettings("t1", key(TOPHITS, { favoriteSignature: SIG_T }));
    setActionSettings("cp", { action: "com.r-teller.sonoscontroller.currently-playing", uuid: SPK, displayMarqueeTitle: true });
    for (const c of ["k1", "t1", "cp"]) addContext({ UUID: SPK, context: c });
    updateSpeakerState({ UUID: SPK, state: playingState(SIG_K) });

    const refresh = vi.fn();
    const stop = startRenderTicker({ refreshStateAndTitle: refresh, intervalMs: 500 });
    vi.advanceTimersByTime(1500);
    const contexts = refresh.mock.calls.map((c) => c[0].inContext);
    expect(contexts.filter((c) => c === "k1")).toHaveLength(3);
    expect(contexts.filter((c) => c === "cp")).toHaveLength(3);
    expect(contexts).not.toContain("t1");
    // ticker frames are the only renders that advance scrolling text (sonos-9at)
    expect(refresh.mock.calls.every((c) => c[0].advanceMarquee === true)).toBe(true);
    stop();
    refresh.mockClear();
    vi.advanceTimersByTime(1000);
    expect(refresh).not.toHaveBeenCalled();
  });

  test("relative Sonos art paths become absolute on the speaker", () => {
    const c = new SonosController().connect("192.168.50.80");
    expect(c.absoluteArtURI("/getaa?s=1&u=x")).toBe("http://192.168.50.80:1400/getaa?s=1&u=x");
    expect(c.absoluteArtURI("https://i.scdn.co/a")).toBe("https://i.scdn.co/a");
    expect(c.absoluteArtURI("")).toBe("");
  });
});

describe("polling reads queue info only for speakers with favorite keys", () => {
  afterEach(() => vi.useRealTimers());

  test("adds mediaURI + queueSignature to state and calls afterPoll", async () => {
    vi.useFakeTimers();
    setActionSettings("k1", key(KENDRICK, { favoriteSignature: SIG_K }));
    addContext({ UUID: SPK, context: "k1", hostAddress: "192.168.50.80" });
    const ok = (v) => vi.fn().mockResolvedValue(v);
    const controller = {
      getTransportSettings: ok({ playMode: "NORMAL" }),
      getTransportInfo: ok({ playbackState: "PLAYING" }),
      getMute: ok(false),
      getVolume: ok(20),
      getBass: ok(0),
      getTreble: ok(0),
      getPositionInfo: ok({ trackURI: "x-sonos-spotify:luther", title: "luther (with sza)", albumArtURI: "" }),
      getMediaInfo: ok({ currentURI: QUEUE }),
      getQueueSignature: ok(SIG_K),
    };
    const afterPoll = vi.fn();
    const stop = startPollingSupervisor({
      intervalMs: 500,
      controllerFactory: () => controller,
      afterPoll,
      getGlobals: () => ({}),
    });
    await vi.advanceTimersByTimeAsync(600);
    stop();
    expect(controller.getQueueSignature).toHaveBeenCalledTimes(1);
    expect(getSpeaker({ UUID: SPK }).state).toMatchObject({ mediaURI: QUEUE, queueSignature: SIG_K });
    expect(afterPoll).toHaveBeenCalledWith(SPK);
  });

  test("a play-mode key reads the media URI but not the queue signature (sonos-8cc)", async () => {
    vi.useFakeTimers();
    setActionSettings("p1", {
      action: "com.r-teller.sonoscontroller.toggle-play-mode",
      uuid: SPK,
      hostAddress: "192.168.50.80",
    });
    addContext({ UUID: SPK, context: "p1", hostAddress: "192.168.50.80" });
    const ok = (v) => vi.fn().mockResolvedValue(v);
    const controller = {
      getTransportSettings: ok({ playMode: "NORMAL" }),
      getTransportInfo: ok({ playbackState: "PLAYING" }),
      getMute: ok(false),
      getVolume: ok(20),
      getBass: ok(0),
      getTreble: ok(0),
      getPositionInfo: ok({ trackURI: "x-sonosapi-stream:s1", title: "Radio", albumArtURI: "" }),
      getMediaInfo: ok({ currentURI: "x-sonosapi-stream:s1" }),
      getQueueSignature: ok(SIG_K),
    };
    const stop = startPollingSupervisor({ intervalMs: 500, controllerFactory: () => controller, getGlobals: () => ({}) });
    await vi.advanceTimersByTimeAsync(600);
    stop();
    expect(controller.getMediaInfo).toHaveBeenCalledTimes(1);
    expect(controller.getQueueSignature).not.toHaveBeenCalled();
    expect(getSpeaker({ UUID: SPK }).state.mediaURI).toBe("x-sonosapi-stream:s1");
  });
});
