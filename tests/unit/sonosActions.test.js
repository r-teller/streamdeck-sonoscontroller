import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

// @elgato/streamdeck reads manifest.json at import time. Stub it before
// importing modules that transitively reach the SDK (sdConnect via dispatcher).
vi.mock("@elgato/streamdeck", () => ({ EventEmitter }));

// Mock the SonosController used by the action helpers — every action
// constructs `new SonosController(); c.connect(host); ...`.
const sonosMock = {
  connect: vi.fn(),
  setMute: vi.fn(),
  setVolume: vi.fn(),
  setBass: vi.fn(),
  setTreble: vi.fn(),
  setPlayMode: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  next: vi.fn(),
  previous: vi.fn(),
  setLocalTransport: vi.fn(),
  setServiceURI: vi.fn(),
  getMute: vi.fn(),
  getVolume: vi.fn(),
  getBass: vi.fn(),
  getTreble: vi.fn(),
  getTransportInfo: vi.fn(),
  getPositionInfo: vi.fn(),
};

vi.mock("@/modules/common/sonosController.js", () => ({
  SonosController: vi.fn().mockImplementation(() => sonosMock),
}));

import {
  actionFunctionMap,
  _resetActionFunctionMap,
} from "@/modules/plugin/actionDispatcher.js";
import { globalSettings } from "@/modules/plugin/globalSettings.js";

// Importing for side effect: registers handlers into actionFunctionMap.
import "@/modules/actions/sonosActions.js";

const SETTINGS_BASE = {
  uuid: "RINCON_X",
  hostAddress: "192.168.1.42",
  zoneName: "Office",
};

beforeEach(() => {
  for (const k of Object.keys(sonosMock)) {
    if (typeof sonosMock[k] === "function") sonosMock[k].mockReset();
  }
  // Defaults: succeed without throwing.
  sonosMock.setMute.mockResolvedValue(undefined);
  sonosMock.setVolume.mockResolvedValue(undefined);
  sonosMock.setBass.mockResolvedValue(undefined);
  sonosMock.setTreble.mockResolvedValue(undefined);
  sonosMock.setPlayMode.mockResolvedValue(undefined);
  sonosMock.play.mockResolvedValue(undefined);
  sonosMock.pause.mockResolvedValue(undefined);
  sonosMock.next.mockResolvedValue(undefined);
  sonosMock.previous.mockResolvedValue(undefined);
  sonosMock.setLocalTransport.mockResolvedValue(undefined);
  sonosMock.setServiceURI.mockResolvedValue(undefined);
  sonosMock.getMute.mockResolvedValue(false);
  sonosMock.getVolume.mockResolvedValue(50);
  sonosMock.getBass.mockResolvedValue(0);
  sonosMock.getTreble.mockResolvedValue(0);
  sonosMock.getTransportInfo.mockResolvedValue({ playbackState: "PLAYING" });
  sonosMock.getPositionInfo.mockResolvedValue({
    title: "Track",
    artist: "Artist",
    album: "Album",
    albumArtURI: "/art",
    trackURI: "x-rincon-queue:RINCON_X#0",
  });
  globalSettings.value = { deviceTimeoutDuration: 10, adjustVolumeIncrement: 10 };
});

describe("sonosActions — registry coverage (km1.*)", () => {
  it("every action has at least one handler in keyDown OR dialRotate (excluding currently-playing's read-only state)", () => {
    const keypadActions = [
      "currently-playing",
      "toggle-mute-unmute",
      "toggle-play-pause",
      "toggle-play-mode",
      "toggle-input-source",
      "play-next-track",
      "play-previous-track",
      "volume-up",
      "volume-down",
      "play-sonos-favorite",
    ];
    for (const a of keypadActions) {
      expect(actionFunctionMap[a].keyDown.length).toBeGreaterThan(0);
      expect(actionFunctionMap[a].state.keypad).toBeTypeOf("function");
    }
    expect(actionFunctionMap["encoder-audio-equalizer"].dialRotate.length).toBeGreaterThan(0);
    expect(actionFunctionMap["encoder-audio-equalizer"].state.encoder).toBeTypeOf("function");
  });
});

describe("sonosActions — toggle-mute-unmute (km1.2)", () => {
  it("muted=false → SetMute(true), projection muted=true, stateIndex 1", async () => {
    const handler = actionFunctionMap["toggle-mute-unmute"].keyDown[0];
    const result = await handler({
      inActionSettings: { ...SETTINGS_BASE },
      inSonosSpeakerState: { muted: false },
    });
    expect(sonosMock.setMute).toHaveBeenCalledWith(true);
    expect(result.status).toBe("SUCCESS");
    expect(result.updatedSonosSpeakerState).toEqual({ muted: true });

    const stateFn = actionFunctionMap["toggle-mute-unmute"].state.keypad;
    expect(stateFn({}, { muted: true }).stateIndex).toBe(1);
    expect(stateFn({}, { muted: false }).stateIndex).toBe(0);
  });
});

describe("sonosActions — toggle-play-pause (km1.3)", () => {
  it("playbackState PLAYING → pause; projection PAUSED_PLAYBACK; stateIndex 0 (Paused)", async () => {
    const handler = actionFunctionMap["toggle-play-pause"].keyDown[0];
    const result = await handler({
      inActionSettings: { ...SETTINGS_BASE },
      inSonosSpeakerState: { playbackState: "PLAYING" },
    });
    expect(sonosMock.pause).toHaveBeenCalled();
    expect(sonosMock.play).not.toHaveBeenCalled();
    expect(result.updatedSonosSpeakerState.playbackState).toBe("PAUSED_PLAYBACK");
  });

  it("playbackState STOPPED → play; projection PLAYING", async () => {
    const handler = actionFunctionMap["toggle-play-pause"].keyDown[0];
    const result = await handler({
      inActionSettings: { ...SETTINGS_BASE },
      inSonosSpeakerState: { playbackState: "STOPPED" },
    });
    expect(sonosMock.play).toHaveBeenCalled();
    expect(result.updatedSonosSpeakerState.playbackState).toBe("PLAYING");
  });

  it("state.keypad: STOPPED→2, PLAYING→1, PAUSED→0", () => {
    const stateFn = actionFunctionMap["toggle-play-pause"].state.keypad;
    expect(stateFn({}, { playbackState: "PAUSED_PLAYBACK" }).stateIndex).toBe(0);
    expect(stateFn({}, { playbackState: "PLAYING" }).stateIndex).toBe(1);
    expect(stateFn({}, { playbackState: "STOPPED" }).stateIndex).toBe(2);
  });
});

describe("sonosActions — toggle-play-mode (km1.4)", () => {
  it("cycles through allowed list, wrapping at the end", async () => {
    const handler = actionFunctionMap["toggle-play-mode"].keyDown[0];
    const settings = {
      ...SETTINGS_BASE,
      selectedPlayModes: ["NORMAL", "SHUFFLE"],
    };
    const r1 = await handler({
      inActionSettings: settings,
      inSonosSpeakerState: { playMode: "NORMAL" },
    });
    expect(sonosMock.setPlayMode).toHaveBeenLastCalledWith("SHUFFLE");
    expect(r1.updatedSonosSpeakerState.playMode).toBe("SHUFFLE");

    const r2 = await handler({
      inActionSettings: settings,
      inSonosSpeakerState: { playMode: "SHUFFLE" },
    });
    expect(sonosMock.setPlayMode).toHaveBeenLastCalledWith("NORMAL");
    expect(r2.updatedSonosSpeakerState.playMode).toBe("NORMAL");
  });

  it("falls back to first selected when current is not in the allow-list", async () => {
    const handler = actionFunctionMap["toggle-play-mode"].keyDown[0];
    const result = await handler({
      inActionSettings: { ...SETTINGS_BASE, selectedPlayModes: ["SHUFFLE", "REPEAT_ALL"] },
      inSonosSpeakerState: { playMode: "NORMAL" }, // not in allow-list
    });
    expect(sonosMock.setPlayMode).toHaveBeenLastCalledWith("SHUFFLE");
    expect(result.updatedSonosSpeakerState.playMode).toBe("SHUFFLE");
  });
});

describe("sonosActions — toggle-input-source (km1.5)", () => {
  it("cycles SONOS_QUEUE → TV_INPUT → LINE_IN → SONOS_QUEUE", async () => {
    const handler = actionFunctionMap["toggle-input-source"].keyDown[0];
    const settings = { ...SETTINGS_BASE };
    const r1 = await handler({
      inActionSettings: settings,
      inSonosSpeakerState: { currentURI: "x-rincon-queue:RINCON_X#0" },
    });
    expect(sonosMock.setLocalTransport).toHaveBeenLastCalledWith("x-sonos-htastream:", ":spdif");
    expect(r1.updatedSonosSpeakerState.currentURI).toContain("x-sonos-htastream:");
  });
});

describe("sonosActions — play-next/previous-track (km1.6/7)", () => {
  it("play-next-track calls Sonos next and returns SUCCESS", async () => {
    const handler = actionFunctionMap["play-next-track"].keyDown[0];
    const result = await handler({ inActionSettings: { ...SETTINGS_BASE }, inSonosSpeakerState: {} });
    expect(sonosMock.next).toHaveBeenCalled();
    expect(result.status).toBe("SUCCESS");
  });

  it("play-previous-track calls Sonos previous and returns SUCCESS", async () => {
    const handler = actionFunctionMap["play-previous-track"].keyDown[0];
    const result = await handler({ inActionSettings: { ...SETTINGS_BASE }, inSonosSpeakerState: {} });
    expect(sonosMock.previous).toHaveBeenCalled();
    expect(result.status).toBe("SUCCESS");
  });
});

describe("sonosActions — volume-up / volume-down (km1.8/9)", () => {
  it("volume-up clamps at 100 with global increment 10", async () => {
    const handler = actionFunctionMap["volume-up"].keyDown[0];
    const r = await handler({
      inActionSettings: { ...SETTINGS_BASE },
      inSonosSpeakerState: { audioEqualizer: { volume: 95 } },
    });
    expect(sonosMock.setVolume).toHaveBeenLastCalledWith(100);
    expect(r.updatedSonosSpeakerState.audioEqualizer.volume).toBe(100);
  });

  it("volume-down clamps at 0", async () => {
    const handler = actionFunctionMap["volume-down"].keyDown[0];
    const r = await handler({
      inActionSettings: { ...SETTINGS_BASE },
      inSonosSpeakerState: { audioEqualizer: { volume: 5 } },
    });
    expect(sonosMock.setVolume).toHaveBeenLastCalledWith(0);
    expect(r.updatedSonosSpeakerState.audioEqualizer.volume).toBe(0);
  });

  it("AC: per-button override of 1 is preserved (PR #4 regression — `??` not `||`)", async () => {
    const handler = actionFunctionMap["volume-up"].keyDown[0];
    await handler({
      inActionSettings: { ...SETTINGS_BASE, adjustVolumeIncrement: 1 },
      inSonosSpeakerState: { audioEqualizer: { volume: 50 } },
    });
    expect(sonosMock.setVolume).toHaveBeenLastCalledWith(51);
  });

  it("global default 10 used when per-button override is null", async () => {
    const handler = actionFunctionMap["volume-up"].keyDown[0];
    await handler({
      inActionSettings: { ...SETTINGS_BASE, adjustVolumeIncrement: null },
      inSonosSpeakerState: { audioEqualizer: { volume: 50 } },
    });
    expect(sonosMock.setVolume).toHaveBeenLastCalledWith(60);
  });
});

describe("sonosActions — play-sonos-favorite (km1.10)", () => {
  it("missing favorite → ERROR", async () => {
    const handler = actionFunctionMap["play-sonos-favorite"].keyDown[0];
    const r = await handler({ inActionSettings: { ...SETTINGS_BASE }, inSonosSpeakerState: {} });
    expect(r.status).toBe("ERROR");
  });

  it("with favorite → setServiceURI called; projection sets PLAYING + currentURI", async () => {
    const fav = {
      title: "Morning Mix",
      uri: "x-rincon-cpcontainer:abc",
      metadata: "<DIDL/>",
      albumArtURI: "/art",
    };
    const handler = actionFunctionMap["play-sonos-favorite"].keyDown[0];
    const r = await handler({
      inActionSettings: { ...SETTINGS_BASE, selectedSonosFavorite: fav },
      inSonosSpeakerState: {},
    });
    expect(sonosMock.setServiceURI).toHaveBeenCalledWith(fav);
    expect(r.updatedSonosSpeakerState.playbackState).toBe("PLAYING");
    expect(r.updatedSonosSpeakerState.currentURI).toBe(fav.uri);
  });
});

describe("sonosActions — currently-playing (km1.1)", () => {
  it("keyDown forces a 6-call refresh and returns SUCCESS with merged state", async () => {
    const handler = actionFunctionMap["currently-playing"].keyDown[0];
    const r = await handler({ inActionSettings: { ...SETTINGS_BASE }, inSonosSpeakerState: {} });
    expect(sonosMock.getTransportInfo).toHaveBeenCalled();
    expect(sonosMock.getPositionInfo).toHaveBeenCalled();
    expect(sonosMock.getMute).toHaveBeenCalled();
    expect(sonosMock.getVolume).toHaveBeenCalled();
    expect(sonosMock.getBass).toHaveBeenCalled();
    expect(sonosMock.getTreble).toHaveBeenCalled();
    expect(r.status).toBe("SUCCESS");
    expect(r.updatedSonosSpeakerState.playbackState).toBe("PLAYING");
  });
});

describe("sonosActions — encoder-audio-equalizer (km1.11)", () => {
  it("VOLUME target: dialRotate +5 from 50 → SetVolume(55), clamped at 100", async () => {
    const handler = actionFunctionMap["encoder-audio-equalizer"].dialRotate[0];
    const r = await handler({
      inActionSettings: { ...SETTINGS_BASE, encoderAudioEqualizerTarget: "VOLUME" },
      inSonosSpeakerState: { audioEqualizer: { volume: 50 } },
      inRotation: 5,
    });
    expect(sonosMock.setVolume).toHaveBeenLastCalledWith(55);
    expect(r.updatedSonosSpeakerState.audioEqualizer.volume).toBe(55);

    await handler({
      inActionSettings: { ...SETTINGS_BASE, encoderAudioEqualizerTarget: "VOLUME" },
      inSonosSpeakerState: { audioEqualizer: { volume: 95 } },
      inRotation: 10,
    });
    expect(sonosMock.setVolume).toHaveBeenLastCalledWith(100); // clamped
  });

  it("BASS target: dialRotate -3 from 0 → SetBass(-3), clamped at -10", async () => {
    const handler = actionFunctionMap["encoder-audio-equalizer"].dialRotate[0];
    await handler({
      inActionSettings: { ...SETTINGS_BASE, encoderAudioEqualizerTarget: "BASS" },
      inSonosSpeakerState: { audioEqualizer: { bass: 0 } },
      inRotation: -3,
    });
    expect(sonosMock.setBass).toHaveBeenLastCalledWith(-3);

    await handler({
      inActionSettings: { ...SETTINGS_BASE, encoderAudioEqualizerTarget: "BASS" },
      inSonosSpeakerState: { audioEqualizer: { bass: -8 } },
      inRotation: -5,
    });
    expect(sonosMock.setBass).toHaveBeenLastCalledWith(-10); // clamped
  });

  it("TREBLE target: dialRotate +3 from 8 → SetTreble(10), clamped at +10", async () => {
    const handler = actionFunctionMap["encoder-audio-equalizer"].dialRotate[0];
    await handler({
      inActionSettings: { ...SETTINGS_BASE, encoderAudioEqualizerTarget: "TREBLE" },
      inSonosSpeakerState: { audioEqualizer: { treble: 8 } },
      inRotation: 5,
    });
    expect(sonosMock.setTreble).toHaveBeenLastCalledWith(10);
  });

  it("state.encoder returns feedbackLayout matching the target", () => {
    const stateFn = actionFunctionMap["encoder-audio-equalizer"].state.encoder;
    expect(
      stateFn(
        { encoderAudioEqualizerTarget: "VOLUME" },
        { audioEqualizer: { volume: 60 } },
      ),
    ).toMatchObject({
      feedbackLayout: "./layouts/encoder-bar-0-100.json",
      feedback: { title: "Volume", value: 60, indicator: 60 },
    });
    expect(
      stateFn(
        { encoderAudioEqualizerTarget: "BASS" },
        { audioEqualizer: { bass: -5 } },
      ),
    ).toMatchObject({
      feedbackLayout: "./layouts/encoder-gbar-10-10.json",
      feedback: { title: "Bass", value: -5, indicator: 5 }, // -5 + 10 = 5
    });
  });

  it("touchTap refreshes EQ values from Sonos", async () => {
    const handler = actionFunctionMap["encoder-audio-equalizer"].touchTap[0];
    sonosMock.getVolume.mockResolvedValueOnce(42);
    sonosMock.getBass.mockResolvedValueOnce(2);
    sonosMock.getTreble.mockResolvedValueOnce(-1);
    const r = await handler({ inActionSettings: { ...SETTINGS_BASE }, inSonosSpeakerState: {} });
    expect(r.updatedSonosSpeakerState.audioEqualizer).toEqual({ volume: 42, bass: 2, treble: -1 });
  });
});
