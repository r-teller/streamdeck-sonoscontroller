import { describe, it, expect } from "vitest";
import {
  PLAY_MODES,
  INPUT_SOURCES,
  STATE_BASED_TITLE_ACTIONS,
  actionShortName,
  gateBool,
  coerceIncrement,
  encodeFavoriteMetadata,
  decodeFavoriteMetadata,
  decodeFavorite,
  buildActionSettingsPayload,
} from "@/modules/pi/actionSettingsSchema.js";
import {
  GLOBAL_DEFAULTS,
  clampVolumeIncrement,
  coerceSeconds,
  buildGlobalSettingsPayload,
} from "@/modules/pi/globalSettingsSchema.js";

describe("actionSettingsSchema", () => {
  const baseParams = {
    states: [{ id: 1 }, { id: 2 }],
    controller: "Keypad",
    current: {},
    overrides: {},
  };

  const actions = [
    "com.r-teller.sonoscontroller.toggle-play-mode",
    "com.r-teller.sonoscontroller.currently-playing",
    "com.r-teller.sonoscontroller.volume-up",
  ];

  it("buildActionSettingsPayload returns exactly 26 keys for every action", () => {
    const expectedKeys = [
      "action",
      "states",
      "controller",
      "uuid",
      "title",
      "hostAddress",
      "zoneName",
      "selectedPlayModes",
      "selectedInputSources",
      "encoderAudioEqualizerTarget",
      "encoderPushAction",
      "displayStateBasedTitle",
      "displayAlbumArt",
      "displayMarqueeTitle",
      "displayMarqueeAlbumTitle",
      "displayTrackTime",
      "displayFavoriteBadge",
      "allowRemoveFavorite",
      "selectedSonosFavorite",
      "adjustVolumeIncrement",
      "displayFavoriteName",
      "displayTrackTitle",
      "displayMarquee",
      "displayFavoriteArtwork",
      "displayTrackArtwork",
      "favoriteSignature",
    ].sort();

    actions.forEach((action) => {
      const payload = buildActionSettingsPayload({ ...baseParams, action });
      const keys = Object.keys(payload).sort();
      expect(keys).toEqual(expectedKeys);
    });
  });

  it("gates fields correctly for currently-playing", () => {
    const action = "com.r-teller.sonoscontroller.currently-playing";
    const payload = buildActionSettingsPayload({ ...baseParams, action });

    // Gated fields should be null
    expect(payload.selectedPlayModes).toBeNull();
    expect(payload.selectedInputSources).toBeNull();
    expect(payload.encoderAudioEqualizerTarget).toBeNull();
    expect(payload.encoderPushAction).toBeNull();
    expect(payload.adjustVolumeIncrement).toBeNull();
    expect(payload.selectedSonosFavorite).toBeNull();

    // displayStateBasedTitle not allowed → null
    expect(payload.displayStateBasedTitle).toBeNull();

    // displayMarqueeTitle allowed (in MARQUEE_TITLE_ACTIONS) → defaults false
    expect(payload.displayMarqueeTitle).toBe(false);

    // displayMarqueeAlbumTitle allowed (in MARQUEE_ALBUM_TITLE_ACTIONS) → defaults false
    expect(payload.displayMarqueeAlbumTitle).toBe(false);

    // displayAlbumArt allowed (in ALBUM_ART_ACTIONS) → defaults false
    expect(payload.displayAlbumArt).toBe(false);
  });

  it("provides defaults for toggle-play-mode", () => {
    const action = "com.r-teller.sonoscontroller.toggle-play-mode";
    const payload = buildActionSettingsPayload({ ...baseParams, action });

    expect(payload.selectedPlayModes).toEqual([...PLAY_MODES]);
    expect(payload.displayStateBasedTitle).toBe(false);
    expect(payload.displayMarqueeTitle).toBeNull();
  });

  it("provides defaults for toggle-input-source", () => {
    const action = "com.r-teller.sonoscontroller.toggle-input-source";
    const payload = buildActionSettingsPayload({ ...baseParams, action });

    expect(payload.selectedInputSources).toEqual([...INPUT_SOURCES]);
  });

  it("provides defaults for encoder-audio-equalizer", () => {
    const action = "com.r-teller.sonoscontroller.encoder-audio-equalizer";
    const payload = buildActionSettingsPayload({ ...baseParams, action });

    expect(payload.encoderAudioEqualizerTarget).toBe("VOLUME");
    // dial push defaults to doing nothing; unknown values fall back too (sonos-6sp)
    expect(payload.encoderPushAction).toBe("NONE");
    expect(
      buildActionSettingsPayload({ ...baseParams, action, current: { encoderPushAction: "TOGGLE_MUTE" } }).encoderPushAction,
    ).toBe("TOGGLE_MUTE");
    expect(
      buildActionSettingsPayload({ ...baseParams, action, current: { encoderPushAction: "BOGUS" } }).encoderPushAction,
    ).toBe("NONE");
    expect(payload.displayStateBasedTitle).toBeNull();
    expect(payload.displayAlbumArt).toBeNull();
    expect(payload.displayMarqueeTitle).toBeNull();
    expect(payload.displayMarqueeAlbumTitle).toBeNull();
  });

  it("overrides win over current, current wins over defaults, and states is copied", () => {
    const action = "com.r-teller.sonoscontroller.toggle-play-mode";
    const current = { selectedPlayModes: ["CUSTOM"] };
    const overrides = { selectedPlayModes: ["OVERRIDE"] };
    const payload = buildActionSettingsPayload({
      ...baseParams,
      action,
      current,
      overrides,
    });
    expect(payload.selectedPlayModes).toEqual(["OVERRIDE"]);

    // When no overrides, current should win over defaults
    const payload2 = buildActionSettingsPayload({
      ...baseParams,
      action,
      current: { selectedPlayModes: ["CURRENT"] },
    });
    expect(payload2.selectedPlayModes).toEqual(["CURRENT"]);

    // states copy test
    const originalStates = [{ id: 1 }, { id: 2 }];
    const payload3 = buildActionSettingsPayload({
      ...baseParams,
      action,
      states: originalStates,
    });
    payload3.states.push({ id: 3 });
    expect(originalStates).toHaveLength(2);
  });

  it("coerceIncrement behavior", () => {
    expect(coerceIncrement(1)).toBe(1);
    expect(coerceIncrement(0)).toBe(0);
    expect(coerceIncrement("")).toBeNull();
    expect(coerceIncrement(null)).toBeNull();
    expect(coerceIncrement(undefined)).toBeNull();
    expect(coerceIncrement("5")).toBe(5);
  });

  it("volume-up payload respects overrides and coercion", () => {
    const action = "com.r-teller.sonoscontroller.volume-up";
    const payload = buildActionSettingsPayload({
      ...baseParams,
      action,
      overrides: { adjustVolumeIncrement: 1 },
    });
    expect(payload.adjustVolumeIncrement).toBe(1);

    const payloadEmpty = buildActionSettingsPayload({
      ...baseParams,
      action,
      overrides: { adjustVolumeIncrement: "" },
    });
    expect(payloadEmpty.adjustVolumeIncrement).toBeNull();
  });

  it("toggle-play-pause payload does not include adjustVolumeIncrement even if current has it", () => {
    const action = "com.r-teller.sonoscontroller.toggle-play-pause";
    const payload = buildActionSettingsPayload({
      ...baseParams,
      action,
      current: { adjustVolumeIncrement: 5 },
    });
    expect(payload.adjustVolumeIncrement).toBeNull();
  });

  it("encode/decodeFavoriteMetadata round‑trip for ASCII and UTF‑8 strings", () => {
    const ascii = "<DIDL-Lite>Test</DIDL-Lite>";
    const utf8 = "<DIDL-Lite>Zoë — 🎵</DIDL-Lite>";

    const asciiEncoded = encodeFavoriteMetadata(ascii);
    const asciiDecoded = decodeFavoriteMetadata(asciiEncoded);
    expect(asciiDecoded).toBe(ascii);

    const utf8Encoded = encodeFavoriteMetadata(utf8);
    const utf8Decoded = decodeFavoriteMetadata(utf8Encoded);
    expect(utf8Decoded).toBe(utf8);
  });

  it("decodeFavoriteMetadata passes through raw non‑base64 strings and non‑string inputs", () => {
    const raw = "<raw>";
    expect(decodeFavoriteMetadata(raw)).toBe(raw);
    const num = 123;
    expect(decodeFavoriteMetadata(num)).toBe(num);
  });

  it("decodeFavorite handles null and decodes metadata", () => {
    expect(decodeFavorite(null)).toBeNull();

    const fav = {
      title: "Song",
      uri: "x-rincon-playlist:123",
      metadata: encodeFavoriteMetadata("<DIDL-Lite>Meta</DIDL-Lite>"),
      albumArtURI: "http://example.com/art.png",
    };
    const decoded = decodeFavorite(fav);
    expect(decoded).toEqual({
      title: "Song",
      uri: "x-rincon-playlist:123",
      metadata: "<DIDL-Lite>Meta</DIDL-Lite>",
      albumArtURI: "http://example.com/art.png",
    });
  });

  it("play-sonos-favorite payload persists full favorite record", () => {
    const action = "com.r-teller.sonoscontroller.play-sonos-favorite";
    const fav = {
      title: "Fav",
      uri: "uri",
      metadata: encodeFavoriteMetadata("<DIDL-Lite>Fav</DIDL-Lite>"),
      albumArtURI: "art",
    };
    const payload = buildActionSettingsPayload({
      ...baseParams,
      action,
      current: { selectedSonosFavorite: fav },
    });
    expect(payload.selectedSonosFavorite).toEqual({
      title: "Fav",
      uri: "uri",
      metadata: "<DIDL-Lite>Fav</DIDL-Lite>",
      albumArtURI: "art",
    });
  });

  it("gateBool returns correct values based on allow‑list", () => {
    const shortName = "toggle-play-mode";
    expect(gateBool(STATE_BASED_TITLE_ACTIONS, shortName, undefined)).toBe(false);
    expect(gateBool(STATE_BASED_TITLE_ACTIONS, shortName, true)).toBe(true);
    expect(gateBool(STATE_BASED_TITLE_ACTIONS, "unknown", true)).toBeNull();
  });

  it("actionShortName extracts correctly and handles empty input", () => {
    const uuid = "com.r-teller.sonoscontroller.toggle-play-mode";
    expect(actionShortName(uuid)).toBe("toggle-play-mode");
    expect(actionShortName("")).toBe("");
    expect(actionShortName(null)).toBe("");
  });
});

describe("globalSettingsSchema", () => {
  it("clampVolumeIncrement enforces minimum of 1", () => {
    expect(clampVolumeIncrement(0)).toBe(1);
    expect(clampVolumeIncrement(-5)).toBe(1);
    expect(clampVolumeIncrement(NaN)).toBe(1);
    expect(clampVolumeIncrement(1)).toBe(1);
    expect(clampVolumeIncrement(10)).toBe(10);
  });

  it("coerceSeconds returns fallback for invalid inputs", () => {
    const fallback = 7;
    expect(coerceSeconds("abc", fallback)).toBe(fallback);
    expect(coerceSeconds(0, fallback)).toBe(fallback);
    expect(coerceSeconds(null, fallback)).toBe(fallback);
    expect(coerceSeconds(5, fallback)).toBe(5);
  });

  it("buildGlobalSettingsPayload returns defaults for empty input and copies arrays", () => {
    const payload = buildGlobalSettingsPayload({});
    expect(payload).toEqual({
      devices: {},
      deviceCheckInterval: GLOBAL_DEFAULTS.deviceCheckInterval,
      deviceTimeoutDuration: GLOBAL_DEFAULTS.deviceTimeoutDuration,
      adjustVolumeIncrement: GLOBAL_DEFAULTS.adjustVolumeIncrement,
      favorites: [],
      speakerReplacements: {},
    });

    const originalFavorites = [{ title: "A" }, { title: "B" }];
    const payload2 = buildGlobalSettingsPayload({ favorites: originalFavorites, adjustVolumeIncrement: 0 });
    // adjustVolumeIncrement should be clamped to 1
    expect(payload2.adjustVolumeIncrement).toBe(1);
    // favorites should be a copy
    expect(payload2.favorites).toEqual(originalFavorites);
    payload2.favorites.push({ title: "C" });
    expect(originalFavorites).toHaveLength(2);
  });
});
