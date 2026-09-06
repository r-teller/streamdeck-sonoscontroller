import { describe, it, expect, vi, beforeEach } from "vitest";

// Partial-mock helpers: keep everything real except makeController
let controller; // per-test stub, assigned in beforeEach
vi.mock("@/modules/actions/helpers.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, makeController: vi.fn(() => controller) };
});

import { actionFunctionMap, _resetActionFunctionMap } from "@/modules/plugin/actionDispatcher.js";
import { registerSonosActions } from "@/modules/actions/sonosActions.js";
import { makeController } from "@/modules/actions/helpers.js";
import { setGlobalSettings } from "@/modules/plugin/globalSettings.js";

beforeEach(() => {
  vi.clearAllMocks();
  setGlobalSettings({});            // reset global settings blob
  _resetActionFunctionMap();        // empty registry
  registerSonosActions();           // idempotent re-registration
  controller = {
    setVolume: vi.fn().mockResolvedValue(undefined),
    setServiceURI: vi.fn().mockResolvedValue(undefined),
  };
});

describe("volume-up action", () => {
  const actionKey = "volume-up";

  it("basic increment (no overrides) → setVolume 52", async () => {
    const result = await actionFunctionMap[actionKey].keyDown[0]({
      inActionSettings: { hostAddress: "h", uuid: "u" },
      inSonosSpeakerState: { audioEqualizer: { volume: 42 } },
    });
    expect(result).toEqual({
      status: "SUCCESS",
      updatedSonosSpeakerState: { audioEqualizer: { volume: 52 } },
    });
    expect(controller.setVolume).toHaveBeenCalledTimes(1);
    expect(controller.setVolume).toHaveBeenCalledWith(52);
  });

  it("clamps at 100", async () => {
    const result = await actionFunctionMap[actionKey].keyDown[0]({
      inActionSettings: { hostAddress: "h", uuid: "u" },
      inSonosSpeakerState: { audioEqualizer: { volume: 95 } },
    });
    expect(result.updatedSonosSpeakerState.audioEqualizer.volume).toBe(100);
    expect(controller.setVolume).toHaveBeenCalledWith(100);
  });

  it("missing volume defaults to 0 → setVolume 10", async () => {
    const result = await actionFunctionMap[actionKey].keyDown[0]({
      inActionSettings: { hostAddress: "h", uuid: "u" },
      inSonosSpeakerState: {}, // no audioEqualizer
    });
    expect(result.updatedSonosSpeakerState.audioEqualizer.volume).toBe(10);
    expect(controller.setVolume).toHaveBeenCalledWith(10);
  });

  describe("increment resolution matrix", () => {
    const baseState = { audioEqualizer: { volume: 50 } };

    it("per‑button override (1) is honored", async () => {
      await actionFunctionMap[actionKey].keyDown[0]({
        inActionSettings: { hostAddress: "h", uuid: "u", adjustVolumeIncrement: 1 },
        inSonosSpeakerState: baseState,
      });
      expect(controller.setVolume).toHaveBeenCalledWith(51);
    });

    it("null per‑button falls back to global (5)", async () => {
      setGlobalSettings({ adjustVolumeIncrement: 5 });
      await actionFunctionMap[actionKey].keyDown[0]({
        inActionSettings: { hostAddress: "h", uuid: "u", adjustVolumeIncrement: null },
        inSonosSpeakerState: baseState,
      });
      expect(controller.setVolume).toHaveBeenCalledWith(55);
    });

    it("no per‑button & no global uses default 10", async () => {
      await actionFunctionMap[actionKey].keyDown[0]({
        inActionSettings: { hostAddress: "h", uuid: "u" },
        inSonosSpeakerState: baseState,
      });
      expect(controller.setVolume).toHaveBeenCalledWith(60);
    });
  });

  describe("state rendering", () => {
    const stateFn = actionFunctionMap[actionKey].state.keypad;

    it("title when displayStateBasedTitle true and volume present", () => {
      const out = stateFn({
        inActionSettings: { displayStateBasedTitle: true },
        inSonosSpeakerState: { audioEqualizer: { volume: 42 } },
      });
      expect(out).toEqual({ title: "Vol 42" });
    });

    it("title uses em dash when volume missing", () => {
      const out = stateFn({
        inActionSettings: { displayStateBasedTitle: true },
        inSonosSpeakerState: {}, // no volume
      });
      expect(out).toEqual({ title: "Vol —" });
    });

    it("title is null when displayStateBasedTitle false", () => {
      const out = stateFn({
        inActionSettings: { displayStateBasedTitle: false },
        inSonosSpeakerState: { audioEqualizer: { volume: 42 } },
      });
      expect(out).toEqual({ title: null });
    });
  });
});

describe("volume-down action", () => {
  const actionKey = "volume-down";

  it("clamps at 0", async () => {
    const result = await actionFunctionMap[actionKey].keyDown[0]({
      inActionSettings: { hostAddress: "h", uuid: "u" },
      inSonosSpeakerState: { audioEqualizer: { volume: 4 } },
    });
    expect(result.updatedSonosSpeakerState.audioEqualizer.volume).toBe(0);
    expect(controller.setVolume).toHaveBeenCalledWith(0);
  });
});

describe("play-sonos-favorite action", () => {
  const actionKey = "play-sonos-favorite";

  it("returns ERROR when favorite missing (null)", async () => {
    const result = await actionFunctionMap[actionKey].keyDown[0]({
      inActionSettings: { hostAddress: "h", uuid: "u", selectedSonosFavorite: null },
    });
    expect(result).toEqual({ status: "ERROR" });
    expect(makeController).not.toHaveBeenCalled();
  });

  it("returns ERROR when favorite missing (empty object)", async () => {
    const result = await actionFunctionMap[actionKey].keyDown[0]({
      inActionSettings: { hostAddress: "h", uuid: "u", selectedSonosFavorite: {} },
    });
    expect(result).toEqual({ status: "ERROR" });
    expect(makeController).not.toHaveBeenCalled();
  });

  it("happy path – calls setServiceURI and returns projection", async () => {
    const favorite = {
      title: "Jazz",
      uri: "x-sonosapi-stream:s123?sid=254",
      metadata: "<DIDL-Lite>…</DIDL-Lite>",
      albumArtURI: "http://art",
    };
    const result = await actionFunctionMap[actionKey].keyDown[0]({
      inActionSettings: {
        hostAddress: "10.0.0.5",
        uuid: "RINCON_A",
        selectedSonosFavorite: favorite,
      },
    });
    expect(makeController).toHaveBeenCalledTimes(1);
    expect(controller.setServiceURI).toHaveBeenCalledTimes(1);
    expect(controller.setServiceURI).toHaveBeenCalledWith(favorite);
    expect(result).toEqual({
      status: "SUCCESS",
      updatedSonosSpeakerState: {
        playbackState: "PLAYING",
        currentURI: favorite.uri,
        playing: {
          title: favorite.title,
          albumArtURI: favorite.albumArtURI,
        },
      },
    });
  });

  it("propagates controller error as ERROR status", async () => {
    controller.setServiceURI.mockRejectedValueOnce(new Error("boom"));
    const favorite = { title: "Rock", uri: "x-sonosapi-stream:s999?sid=254", albumArtURI: "http://art2" };
    const result = await actionFunctionMap[actionKey].keyDown[0]({
      inActionSettings: {
        hostAddress: "h",
        uuid: "u",
        selectedSonosFavorite: favorite,
      },
    });
    expect(result).toEqual({ status: "ERROR" });
  });
});
