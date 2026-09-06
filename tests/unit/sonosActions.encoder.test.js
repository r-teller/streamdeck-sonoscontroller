import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  // default stub – individual tests will override needed methods
  controller = {
    setVolume: vi.fn().mockResolvedValue(undefined),
    setBass: vi.fn().mockResolvedValue(undefined),
    setTreble: vi.fn().mockResolvedValue(undefined),
    getVolume: vi.fn().mockResolvedValue(0),
    getBass: vi.fn().mockResolvedValue(0),
    getTreble: vi.fn().mockResolvedValue(0),
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("encoder-audio-equalizer action", () => {
  const dialRotate = actionFunctionMap["encoder-audio-equalizer"].dialRotate[0];
  const touchTap = actionFunctionMap["encoder-audio-equalizer"].touchTap[0];
  const stateEncoder = actionFunctionMap["encoder-audio-equalizer"].state.encoder;

  it("dialRotate default target VOLUME applies rotation once", async () => {
    const result = await dialRotate({
      inActionSettings: {},
      inSonosSpeakerState: { audioEqualizer: { volume: 42 } },
      inRotation: 3,
    });
    expect(controller.setVolume).toHaveBeenCalledTimes(1);
    expect(controller.setVolume).toHaveBeenCalledWith(45);
    expect(result).toEqual({
      status: "SUCCESS",
      updatedSonosSpeakerState: { audioEqualizer: { volume: 45 } },
    });
  });

  it("dialRotate VOLUME clamps at 0 and 100", async () => {
    // upper clamp
    controller.setVolume.mockClear();
    await dialRotate({
      inActionSettings: {},
      inSonosSpeakerState: { audioEqualizer: { volume: 99 } },
      inRotation: 5,
    });
    expect(controller.setVolume).toHaveBeenCalledWith(100);

    // lower clamp
    controller.setVolume.mockClear();
    await dialRotate({
      inActionSettings: {},
      inSonosSpeakerState: { audioEqualizer: { volume: 2 } },
      inRotation: -5,
    });
    expect(controller.setVolume).toHaveBeenCalledWith(0);
  });

  it("dialRotate BASS target respects clamp -10..10", async () => {
    const result = await dialRotate({
      inActionSettings: { encoderAudioEqualizerTarget: "BASS" },
      inSonosSpeakerState: { audioEqualizer: { bass: 8 } },
      inRotation: 5,
    });
    expect(controller.setBass).toHaveBeenCalledTimes(1);
    expect(controller.setBass).toHaveBeenCalledWith(10); // clamp to +10
    expect(result).toEqual({
      status: "SUCCESS",
      updatedSonosSpeakerState: { audioEqualizer: { bass: 10 } },
    });

    controller.setBass.mockClear();
    const result2 = await dialRotate({
      inActionSettings: { encoderAudioEqualizerTarget: "BASS" },
      inSonosSpeakerState: { audioEqualizer: { bass: -8 } },
      inRotation: -5,
    });
    expect(controller.setBass).toHaveBeenCalledWith(-10); // clamp to -10
    expect(result2).toEqual({
      status: "SUCCESS",
      updatedSonosSpeakerState: { audioEqualizer: { bass: -10 } },
    });
  });

  it("dialRotate TREBLE target respects clamp -10..10", async () => {
    const result = await dialRotate({
      inActionSettings: { encoderAudioEqualizerTarget: "TREBLE" },
      inSonosSpeakerState: { audioEqualizer: { treble: 0 } },
      inRotation: -3,
    });
    expect(controller.setTreble).toHaveBeenCalledTimes(1);
    expect(controller.setTreble).toHaveBeenCalledWith(-3);
    expect(result).toEqual({
      status: "SUCCESS",
      updatedSonosSpeakerState: { audioEqualizer: { treble: -3 } },
    });
  });

  it("dialRotate missing state defaults to 0", async () => {
    await dialRotate({
      inActionSettings: {},
      inSonosSpeakerState: {}, // no audioEqualizer
      inRotation: 4,
    });
    expect(controller.setVolume).toHaveBeenCalledWith(4);
  });

  it("touchTap performs three refresh calls", async () => {
    controller.getVolume.mockResolvedValueOnce(30);
    controller.getBass.mockResolvedValueOnce(-2);
    controller.getTreble.mockResolvedValueOnce(7);

    const result = await touchTap({
      inActionSettings: {},
    });

    expect(controller.getVolume).toHaveBeenCalledTimes(1);
    expect(controller.getBass).toHaveBeenCalledTimes(1);
    expect(controller.getTreble).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      status: "SUCCESS",
      updatedSonosSpeakerState: {
        audioEqualizer: { volume: 30, bass: -2, treble: 7 },
      },
    });
  });

  it("touchTap propagates errors", async () => {
    controller.getVolume.mockResolvedValueOnce(30);
    controller.getBass.mockRejectedValueOnce(new Error("boom"));
    const result = await touchTap({ inActionSettings: {} });
    expect(result).toEqual({ status: "ERROR" });
  });

  it("dialDown slot is empty array", () => {
    const dialDown = actionFunctionMap["encoder-audio-equalizer"].dialDown;
    expect(dialDown).toBeInstanceOf(Array);
    expect(dialDown).toHaveLength(0);
  });

  it("state.encoder for VOLUME returns correct layout and feedback", () => {
    const render = stateEncoder({
      inActionSettings: {},
      inSonosSpeakerState: { audioEqualizer: { volume: 45 } },
    });
    expect(render).toEqual({
      feedbackLayout: "./layouts/encoder-bar-0-100.json",
      feedback: {
        title: "Volume",
        value: 45,
        indicator: 45,
      },
    });
  });

  it("state.encoder for BASS returns correct layout and indicator", () => {
    const render = stateEncoder({
      inActionSettings: { encoderAudioEqualizerTarget: "BASS" },
      inSonosSpeakerState: { audioEqualizer: { bass: -3 } },
    });
    expect(render).toEqual({
      feedbackLayout: "./layouts/encoder-gbar-10-10.json",
      feedback: {
        title: "Bass",
        value: -3,
        indicator: 7, // -3 + 10
      },
    });
  });

  it("state.encoder for TREBLE handles missing value", () => {
    const render = stateEncoder({
      inActionSettings: { encoderAudioEqualizerTarget: "TREBLE" },
      inSonosSpeakerState: {}, // no treble
    });
    expect(render).toEqual({
      feedbackLayout: "./layouts/encoder-gbar-10-10.json",
      feedback: {
        title: "Treble",
        value: 0,
        indicator: 10, // 0 + 10
      },
    });
  });

  it("dialRotate propagates controller errors", async () => {
    controller.setVolume.mockRejectedValueOnce(new Error("fail"));
    const result = await dialRotate({
      inActionSettings: {},
      inSonosSpeakerState: { audioEqualizer: { volume: 10 } },
      inRotation: 5,
    });
    expect(result).toEqual({ status: "ERROR" });
  });

  it("timeout label is correct when operation exceeds deviceTimeoutDuration", async () => {
    vi.useFakeTimers();
    setGlobalSettings({ deviceTimeoutDuration: 2 }); // seconds

    // make setVolume never settle
    controller.setVolume.mockImplementation(() => new Promise(() => {}));

    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const handlerPromise = dialRotate({
      inActionSettings: {},
      inSonosSpeakerState: { audioEqualizer: { volume: 10 } },
      inRotation: 5,
    });

    // advance time to trigger timeout
    await vi.advanceTimersByTimeAsync(2000);

    const result = await handlerPromise;
    expect(result).toEqual({ status: "ERROR" });

    // the warning should contain the exact timeout message
    expect(consoleWarnSpy).toHaveBeenCalledTimes(1);
    const warnedError = consoleWarnSpy.mock.calls[0][1]; // second arg is the error object
    expect(warnedError).toBeInstanceOf(Error);
    expect(warnedError.message).toBe("Timeout while running setVolume after 2 seconds");

    consoleWarnSpy.mockRestore();
    vi.useRealTimers();
  });
});
