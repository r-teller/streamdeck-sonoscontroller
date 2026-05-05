// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  buildActionSettingsPayload,
  decodeBase64Metadata,
  encodeBase64Metadata,
  actionShortName,
  PLAY_MODE_DEFAULTS,
  INPUT_SOURCE_DEFAULTS,
} from "@/modules/pi/actionSettingsSchema.js";

const PREFIX = "com.r-teller.sonoscontroller.";
const baseInput = {
  action: PREFIX + "toggle-mute-unmute",
  states: [{ Name: "Unmuted" }, { Name: "Muted" }],
  controller: "Keypad",
  uuid: "RINCON_xxxxxxxxxxxx01400",
  title: "Office (192.168.1.42)",
  hostAddress: "192.168.1.42",
  zoneName: "Office",
};

describe("actionShortName", () => {
  it("strips the action prefix", () => {
    expect(actionShortName(PREFIX + "toggle-mute-unmute")).toBe(
      "toggle-mute-unmute",
    );
  });

  it("returns input unchanged when prefix is absent", () => {
    expect(actionShortName("toggle-mute-unmute")).toBe("toggle-mute-unmute");
  });

  it("returns empty string for non-string input", () => {
    expect(actionShortName(undefined)).toBe("");
    expect(actionShortName(null)).toBe("");
    expect(actionShortName(42)).toBe("");
  });
});

describe("buildActionSettingsPayload — top-level keys (orw.11 AC)", () => {
  it("writes exactly 16 top-level keys (no extras, no missing)", () => {
    // Schema lists 15 ActionSettings fields; this AC counts top-level only.
    // Note: data-model.md adds optional plugin-managed transient state
    // (currentStateIndex, marqueePosition*, status) but those are NOT written
    // by saveSettings() — the plugin owns them.
    const payload = buildActionSettingsPayload(baseInput);
    expect(Object.keys(payload).sort()).toEqual(
      [
        "action",
        "adjustVolumeIncrement",
        "controller",
        "displayAlbumArt",
        "displayMarqueeAlbumTitle",
        "displayMarqueeTitle",
        "displayStateBasedTitle",
        "encoderAudioEqualizerTarget",
        "hostAddress",
        "selectedInputSources",
        "selectedPlayModes",
        "selectedSonosFavorite",
        "states",
        "title",
        "uuid",
        "zoneName",
      ].sort(),
    );
  });
});

describe("buildActionSettingsPayload — display toggle gating (orw.11 AC)", () => {
  it("toggle-mute-unmute with displayStateBasedTitle=true → persists true; others null", () => {
    const payload = buildActionSettingsPayload({
      ...baseInput,
      displayStateBasedTitle: true,
    });
    expect(payload.displayStateBasedTitle).toBe(true);
    expect(payload.displayMarqueeTitle).toBe(null);
    expect(payload.displayMarqueeAlbumTitle).toBe(null);
    expect(payload.displayAlbumArt).toBe(null);
    expect(payload.selectedPlayModes).toBe(null);
    expect(payload.selectedInputSources).toBe(null);
    expect(payload.encoderAudioEqualizerTarget).toBe(null);
    expect(payload.selectedSonosFavorite).toBe(null);
    expect(payload.adjustVolumeIncrement).toBe(null);
  });

  it("display toggles default to false (not null) when in allow-list and unset", () => {
    // toggle-play-pause is in StateBasedTitle, MarqueeAlbumTitle, AlbumArt allow-lists
    const payload = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "toggle-play-pause",
    });
    expect(payload.displayStateBasedTitle).toBe(false);
    expect(payload.displayMarqueeAlbumTitle).toBe(false);
    expect(payload.displayAlbumArt).toBe(false);
    // Marquee title is NOT in toggle-play-pause's allow-list → null
    expect(payload.displayMarqueeTitle).toBe(null);
  });

  it("currently-playing has all four marquee/art toggles applicable", () => {
    const payload = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "currently-playing",
    });
    // currently-playing is NOT in StateBasedTitle allow-list
    expect(payload.displayStateBasedTitle).toBe(null);
    expect(payload.displayMarqueeTitle).toBe(false);
    expect(payload.displayMarqueeAlbumTitle).toBe(false);
    expect(payload.displayAlbumArt).toBe(false);
  });
});

describe("buildActionSettingsPayload — selectedPlayModes (toggle-play-mode)", () => {
  it("defaults to all 6 modes when not provided", () => {
    const payload = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "toggle-play-mode",
    });
    expect(payload.selectedPlayModes).toEqual([...PLAY_MODE_DEFAULTS]);
  });

  it("honors caller-provided subset (Repeat One unchecked)", () => {
    const payload = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "toggle-play-mode",
      selectedPlayModes: [
        "NORMAL",
        "SHUFFLE_NOREPEAT",
        "SHUFFLE_REPEAT_ONE",
        "SHUFFLE",
        "REPEAT_ALL",
      ],
    });
    expect(payload.selectedPlayModes).toEqual([
      "NORMAL",
      "SHUFFLE_NOREPEAT",
      "SHUFFLE_REPEAT_ONE",
      "SHUFFLE",
      "REPEAT_ALL",
    ]);
  });

  it("is null on non-toggle-play-mode actions even when input provided", () => {
    const payload = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "toggle-mute-unmute",
      selectedPlayModes: ["NORMAL"],
    });
    expect(payload.selectedPlayModes).toBe(null);
  });
});

describe("buildActionSettingsPayload — selectedInputSources (toggle-input-source)", () => {
  it("defaults to all 3 sources when not provided", () => {
    const payload = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "toggle-input-source",
    });
    expect(payload.selectedInputSources).toEqual([...INPUT_SOURCE_DEFAULTS]);
  });

  it("is null on non-applicable actions", () => {
    const payload = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "volume-up",
    });
    expect(payload.selectedInputSources).toBe(null);
  });
});

describe("buildActionSettingsPayload — encoderAudioEqualizerTarget", () => {
  it("defaults to 'VOLUME' on encoder-audio-equalizer", () => {
    const payload = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "encoder-audio-equalizer",
      controller: "Encoder",
    });
    expect(payload.encoderAudioEqualizerTarget).toBe("VOLUME");
  });

  it("honors caller-provided BASS / TREBLE", () => {
    const bass = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "encoder-audio-equalizer",
      controller: "Encoder",
      encoderAudioEqualizerTarget: "BASS",
    });
    expect(bass.encoderAudioEqualizerTarget).toBe("BASS");
  });

  it("is null on non-encoder actions", () => {
    const payload = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "toggle-mute-unmute",
    });
    expect(payload.encoderAudioEqualizerTarget).toBe(null);
  });
});

describe("buildActionSettingsPayload — adjustVolumeIncrement (PR #4 regression)", () => {
  it("preserves value 1 verbatim (NOT falsy-coerced)", () => {
    const payload = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "volume-up",
      adjustVolumeIncrement: 1,
    });
    expect(payload.adjustVolumeIncrement).toBe(1);
  });

  it("preserves value 0 (PR #4 also covered this case via ?? semantics)", () => {
    const payload = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "volume-down",
      adjustVolumeIncrement: 0,
    });
    expect(payload.adjustVolumeIncrement).toBe(0);
  });

  it("persists null for null input", () => {
    const payload = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "volume-up",
      adjustVolumeIncrement: null,
    });
    expect(payload.adjustVolumeIncrement).toBe(null);
  });

  it("persists null for undefined input (no override set)", () => {
    const payload = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "volume-up",
    });
    expect(payload.adjustVolumeIncrement).toBe(null);
  });

  it("persists null for empty-string input (form bound v-model.number with empty input)", () => {
    const payload = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "volume-up",
      adjustVolumeIncrement: "",
    });
    expect(payload.adjustVolumeIncrement).toBe(null);
  });

  it("preserves 15 verbatim", () => {
    const payload = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "volume-up",
      adjustVolumeIncrement: 15,
    });
    expect(payload.adjustVolumeIncrement).toBe(15);
  });

  it("is null on non-volume actions even when input provided", () => {
    const payload = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "toggle-mute-unmute",
      adjustVolumeIncrement: 5,
    });
    expect(payload.adjustVolumeIncrement).toBe(null);
  });
});

describe("buildActionSettingsPayload — selectedSonosFavorite (base64 round-trip)", () => {
  it("base64-decodes metadata back to UTF-8 XML before persisting", () => {
    const xml =
      '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item/></DIDL-Lite>';
    const encoded = encodeBase64Metadata(xml);
    const payload = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "play-sonos-favorite",
      selectedSonosFavorite: {
        title: "Morning Mix",
        uri: "x-rincon-cpcontainer:abc",
        metadata: encoded,
        albumArtURI: "/getaa?u=...",
      },
    });
    expect(payload.selectedSonosFavorite.metadata).toBe(xml);
    expect(payload.selectedSonosFavorite.metadata).toContain("<DIDL-Lite");
  });

  it("preserves title, uri, albumArtURI verbatim", () => {
    const payload = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "play-sonos-favorite",
      selectedSonosFavorite: {
        title: "Morning Mix",
        uri: "x-rincon-cpcontainer:abc",
        metadata: encodeBase64Metadata("<x/>"),
        albumArtURI: "/getaa?u=test",
      },
    });
    expect(payload.selectedSonosFavorite.title).toBe("Morning Mix");
    expect(payload.selectedSonosFavorite.uri).toBe("x-rincon-cpcontainer:abc");
    expect(payload.selectedSonosFavorite.albumArtURI).toBe("/getaa?u=test");
  });

  it("is null when no favorite selected", () => {
    const payload = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "play-sonos-favorite",
    });
    expect(payload.selectedSonosFavorite).toBe(null);
  });

  it("is null on non-favorite actions even when input provided", () => {
    const payload = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "toggle-mute-unmute",
      selectedSonosFavorite: {
        title: "X",
        uri: "y",
        metadata: encodeBase64Metadata("<z/>"),
        albumArtURI: "a",
      },
    });
    expect(payload.selectedSonosFavorite).toBe(null);
  });

  it("round-trips UTF-8 multi-byte characters (smart quotes, emoji)", () => {
    const xml = '<DIDL-Lite><title>Café "Mix" 🎵</title></DIDL-Lite>';
    const encoded = encodeBase64Metadata(xml);
    const payload = buildActionSettingsPayload({
      ...baseInput,
      action: PREFIX + "play-sonos-favorite",
      selectedSonosFavorite: {
        title: "T",
        uri: "u",
        metadata: encoded,
        albumArtURI: "a",
      },
    });
    expect(payload.selectedSonosFavorite.metadata).toBe(xml);
  });
});

describe("decodeBase64Metadata — defensive (orw.11 base64 utility)", () => {
  it("returns non-string input unchanged", () => {
    expect(decodeBase64Metadata(null)).toBe(null);
    expect(decodeBase64Metadata(undefined)).toBe(undefined);
    expect(decodeBase64Metadata(42)).toBe(42);
  });

  it("returns empty string unchanged", () => {
    expect(decodeBase64Metadata("")).toBe("");
  });
});

describe("buildActionSettingsPayload — passes static fields through verbatim", () => {
  it("preserves action, states, controller, uuid, title, hostAddress, zoneName", () => {
    const states = [{ Name: "Unmuted" }, { Name: "Muted" }];
    const payload = buildActionSettingsPayload({
      ...baseInput,
      states,
    });
    expect(payload.action).toBe(PREFIX + "toggle-mute-unmute");
    expect(payload.states).toBe(states);
    expect(payload.controller).toBe("Keypad");
    expect(payload.uuid).toBe("RINCON_xxxxxxxxxxxx01400");
    expect(payload.title).toBe("Office (192.168.1.42)");
    expect(payload.hostAddress).toBe("192.168.1.42");
    expect(payload.zoneName).toBe("Office");
  });
});
