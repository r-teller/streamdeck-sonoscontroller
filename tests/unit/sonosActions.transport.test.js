import { describe, it, expect, vi, beforeEach } from "vitest";

// Partial-mock helpers: keep everything real except makeController
let controller; // per-test stub, assigned in beforeEach
vi.mock("@/modules/actions/helpers.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, makeController: vi.fn(() => controller) };
});

// Mock uri taxonomy to classify input sources
vi.mock("@/common/uriTaxonomy.js", () => ({
  getInputSourceMappings: (uri) => {
    if (uri.includes("x-rincon-queue")) return { currentSource: "Sonos_Queue" };
    if (uri.includes("x-sonos-htastream")) return { currentSource: "TV_Input" };
    if (uri.includes("x-rincon-stream")) return { currentSource: "Line_In" };
    return { currentSource: null };
  },
}));

// Mock marquee builder – used by several render functions
vi.mock("@/modules/plugin/marquee.js", () => ({
  buildMarqueeRenderIntent: vi.fn(() => ({
    imageDataURL: "imgData",
    title: "MarqueeTitle",
    titleSource: "source",
  })),
}));

import { actionFunctionMap, _resetActionFunctionMap } from "@/modules/plugin/actionDispatcher.js";
import { registerSonosActions } from "@/modules/actions/sonosActions.js";
import { makeController } from "@/modules/actions/helpers.js";
import { setGlobalSettings } from "@/modules/plugin/globalSettings.js";

beforeEach(() => {
  vi.clearAllMocks();
  setGlobalSettings({}); // reset global settings blob
  _resetActionFunctionMap(); // empty registry
  registerSonosActions(); // idempotent re-registration
  controller = {
    // generic stubs – overridden per‑test as needed
    getTransportInfo: vi.fn(),
    getPositionInfo: vi.fn(),
    getMute: vi.fn(),
    getVolume: vi.fn(),
    getBass: vi.fn(),
    getTreble: vi.fn(),
    setMute: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    setPlayMode: vi.fn(),
    setLocalTransport: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    setServiceURI: vi.fn(),
    setVolume: vi.fn(),
    setBass: vi.fn(),
    setTreble: vi.fn(),
  };
});

describe("Sonos actions – transport layer (actions 1‑7)", () => {
  // -------------------------------------------------------------------------
  // 1. currently‑playing – success
  // -------------------------------------------------------------------------
  it("currently‑playing keyDown returns full projection and calls all getters once", async () => {
    controller.getTransportInfo.mockResolvedValue({ playbackState: "PLAYING" });
    controller.getPositionInfo.mockResolvedValue({
      trackURI: "x-file:a",
      title: "T",
      artist: "Ar",
      album: "Al",
      albumArtURI: "http://art",
    });
    controller.getMute.mockResolvedValue(true);
    controller.getVolume.mockResolvedValue(42);
    controller.getBass.mockResolvedValue(2);
    controller.getTreble.mockResolvedValue(-1);

    const result = await actionFunctionMap["currently-playing"].keyDown[0]({
      inActionSettings: { hostAddress: "h", uuid: "u" },
    });

    expect(controller.getTransportInfo).toHaveBeenCalledOnce();
    expect(controller.getPositionInfo).toHaveBeenCalledOnce();
    expect(controller.getMute).toHaveBeenCalledOnce();
    expect(controller.getVolume).toHaveBeenCalledOnce();
    expect(controller.getBass).toHaveBeenCalledOnce();
    expect(controller.getTreble).toHaveBeenCalledOnce();

    expect(result).toEqual({
      status: "SUCCESS",
      updatedSonosSpeakerState: {
        playbackState: "PLAYING",
        muted: true,
        audioEqualizer: { volume: 42, bass: 2, treble: -1 },
        currentURI: "x-file:a",
        playing: {
          title: "T",
          artist: "Ar",
          album: "Al",
          albumArtURI: "http://art",
        },
      },
    });
  });

  // -------------------------------------------------------------------------
  // 2. currently‑playing – error propagation
  // -------------------------------------------------------------------------
  it("currently‑playing keyDown returns ERROR when a getter rejects", async () => {
    controller.getTransportInfo.mockResolvedValue({ playbackState: "PLAYING" });
    controller.getPositionInfo.mockResolvedValue({});
    controller.getMute.mockResolvedValue(false);
    controller.getVolume.mockRejectedValue(new Error("boom"));
    controller.getBass.mockResolvedValue(0);
    controller.getTreble.mockResolvedValue(0);

    const result = await actionFunctionMap["currently-playing"].keyDown[0]({
      inActionSettings: { hostAddress: "h", uuid: "u" },
    });

    expect(result).toEqual({ status: "ERROR" });
    expect(result).not.toHaveProperty("updatedSonosSpeakerState");
  });

  // -------------------------------------------------------------------------
  // 3. toggle‑mute‑unmute – inversion logic
  // -------------------------------------------------------------------------
  it.each([
    [{ muted: true }, false],
    [{ muted: false }, true],
    [{}, true],
  ])(
    "toggle‑mute‑unmute inverts muted=%p → setMute(%s)",
    async (state, expected) => {
      controller.setMute.mockResolvedValue(undefined);
      const result = await actionFunctionMap["toggle-mute-unmute"].keyDown[0]({
        inActionSettings: { hostAddress: "h", uuid: "u" },
        inSonosSpeakerState: state,
      });

      expect(controller.setMute).toHaveBeenCalledWith(expected);
      expect(result).toEqual({
        status: "SUCCESS",
        updatedSonosSpeakerState: { muted: expected },
      });
    },
  );

  // -------------------------------------------------------------------------
  // 4. toggle‑play‑pause – branching
  // -------------------------------------------------------------------------
  it.each([
    [{ playbackState: "PLAYING" }, "pause", "PAUSED_PLAYBACK"],
    [{ playbackState: "PAUSED_PLAYBACK" }, "play", "PLAYING"],
    [{ playbackState: "STOPPED" }, "play", "PLAYING"],
    // Sonos is still starting playback: pressing must pause, not send Play again (sonos-1vd)
    [{ playbackState: "TRANSITIONING" }, "pause", "PAUSED_PLAYBACK"],
  ])(
    "toggle‑play‑pause with playbackState=%s calls %s and projects %s",
    async (state, method, projected) => {
      controller[method].mockResolvedValue(undefined);
      const result = await actionFunctionMap["toggle-play-pause"].keyDown[0]({
        inActionSettings: { hostAddress: "h", uuid: "u" },
        inSonosSpeakerState: state,
      });

      expect(controller[method]).toHaveBeenCalledOnce();
      expect(result).toEqual({
        status: "SUCCESS",
        updatedSonosSpeakerState: { playbackState: projected },
      });
    },
  );

  // -------------------------------------------------------------------------
  // 5. toggle‑play‑pause – render state
  // -------------------------------------------------------------------------
  it.each([
    [{ playbackState: "PLAYING" }, 1, "Playing"],
    [{ playbackState: "STOPPED" }, 2, "Stopped"],
    [{ playbackState: "PAUSED_PLAYBACK" }, 0, "Paused"],
    [{ playbackState: "TRANSITIONING" }, 1, "Playing"],
  ])(
    "toggle‑play‑pause state renders correctly for %s",
    async (state, expectedIdx, expectedTitle) => {
      const result = actionFunctionMap["toggle-play-pause"].state.keypad({
        inActionSettings: { displayStateBasedTitle: true },
        inSonosSpeakerState: state,
      });

      expect(result).toMatchObject({
        stateIndex: expectedIdx,
        title: expectedTitle,
        titleSource: null,
        imageDataURL: "imgData",
      });
    },
  );

  // -------------------------------------------------------------------------
  // 6. toggle‑play‑mode – cycling & fallback (as implemented)
  it("toggle‑play‑mode cycles within a subset of allowed modes", async () => {
    controller.setPlayMode.mockResolvedValue(undefined);
    const result = await actionFunctionMap["toggle-play-mode"].keyDown[0]({
      inActionSettings: {
        hostAddress: "h",
        uuid: "u",
        selectedPlayModes: ["NORMAL", "SHUFFLE"],
      },
      inSonosSpeakerState: { playMode: "NORMAL" },
    });

    expect(controller.setPlayMode).toHaveBeenCalledWith("SHUFFLE");
    expect(result).toEqual({
      status: "SUCCESS",
      updatedSonosSpeakerState: { playMode: "SHUFFLE" },
    });
  });

  it("toggle‑play‑mode wraps around to first mode in subset", async () => {
    controller.setPlayMode.mockResolvedValue(undefined);
    const result = await actionFunctionMap["toggle-play-mode"].keyDown[0]({
      inActionSettings: {
        hostAddress: "h",
        uuid: "u",
        selectedPlayModes: ["NORMAL", "SHUFFLE"],
      },
      inSonosSpeakerState: { playMode: "SHUFFLE" },
    });

    expect(controller.setPlayMode).toHaveBeenCalledWith("NORMAL");
    expect(result).toEqual({
      status: "SUCCESS",
      updatedSonosSpeakerState: { playMode: "NORMAL" },
    });
  });

  it("toggle‑play‑mode falls back to first allowed mode when current not in subset", async () => {
    controller.setPlayMode.mockResolvedValue(undefined);
    const result = await actionFunctionMap["toggle-play-mode"].keyDown[0]({
      inActionSettings: {
        hostAddress: "h",
        uuid: "u",
        selectedPlayModes: ["NORMAL", "SHUFFLE"],
      },
      inSonosSpeakerState: { playMode: "REPEAT_ALL" },
    });

    expect(controller.setPlayMode).toHaveBeenCalledWith("NORMAL");
    expect(result).toEqual({
      status: "SUCCESS",
      updatedSonosSpeakerState: { playMode: "NORMAL" },
    });
  });

  it("toggle‑play‑mode cycles through full list when no selectedPlayModes provided", async () => {
    controller.setPlayMode.mockResolvedValue(undefined);
    const result = await actionFunctionMap["toggle-play-mode"].keyDown[0]({
      inActionSettings: { hostAddress: "h", uuid: "u" },
      inSonosSpeakerState: { playMode: "NORMAL" },
    });

    // Full PLAY_MODES list: ["NORMAL","SHUFFLE_NOREPEAT","SHUFFLE_REPEAT_ONE","SHUFFLE","REPEAT_ONE","REPEAT_ALL"]
    expect(controller.setPlayMode).toHaveBeenCalledWith("SHUFFLE_NOREPEAT");
    expect(result).toEqual({
      status: "SUCCESS",
      updatedSonosSpeakerState: { playMode: "SHUFFLE_NOREPEAT" },
    });
  });

  it("toggle‑play‑mode renders title casing and index", () => {
    const result = actionFunctionMap["toggle-play-mode"].state.keypad({
      inActionSettings: { displayStateBasedTitle: true },
      inSonosSpeakerState: { playMode: "SHUFFLE_NOREPEAT" },
    });

    expect(result).toMatchObject({
      stateIndex: 1, // index of SHUFFLE_NOREPEAT in full PLAY_MODES
      title: "Shuffle Norepeat",
    });
  });

  it("toggle‑play‑mode renders null title when gate off", () => {
    const result = actionFunctionMap["toggle-play-mode"].state.keypad({
      inActionSettings: { displayStateBasedTitle: false },
      inSonosSpeakerState: { playMode: "NORMAL" },
    });

    expect(result).toMatchObject({
      stateIndex: 0,
      title: null,
    });
  });

  // -------------------------------------------------------------------------
  // 7. toggle‑input‑source – keyDown logic
  // -------------------------------------------------------------------------
  it("toggle‑input‑source cycles to next source and builds correct projection", async () => {
    controller.setLocalTransport.mockResolvedValue(undefined);
    const result = await actionFunctionMap["toggle-input-source"].keyDown[0]({
      inActionSettings: {
        hostAddress: "10.0.0.5",
        uuid: "RINCON_BOUND",
        selectedInputSources: ["Sonos_Queue", "TV_Input", "Line_In"],
      },
      inSonosSpeakerState: {
        currentURI: "x-rincon-queue:RINCON_OTHER#0",
      },
    });

    // Current classified as Sonos_Queue → next is TV_Input
    expect(controller.setLocalTransport).toHaveBeenCalledWith(
      "x-sonos-htastream", // prefix without trailing colon
      ":spdif",
    );

    expect(result).toEqual({
      status: "SUCCESS",
      updatedSonosSpeakerState: {
        currentURI: "x-sonos-htastream:RINCON_BOUND:spdif",
        playbackState: "PLAYING",
      },
    });
  });

  it("toggle‑input‑source falls back to first allowed source when current not in list", async () => {
    controller.setLocalTransport.mockResolvedValue(undefined);
    const result = await actionFunctionMap["toggle-input-source"].keyDown[0]({
      inActionSettings: {
        hostAddress: "10.0.0.5",
        uuid: "RINCON_BOUND",
        selectedInputSources: ["Sonos_Queue"], // only one allowed
      },
      inSonosSpeakerState: {
        currentURI: "x-sonos-htastream:RINCON_X:spdif", // classified as TV_Input (not allowed)
      },
    });

    // Next should wrap to the only allowed source: Sonos_Queue
    expect(controller.setLocalTransport).toHaveBeenCalledWith(
      "x-rincon-queue",
      "#0",
    );

    expect(result).toEqual({
      status: "SUCCESS",
      updatedSonosSpeakerState: {
        currentURI: "x-rincon-queue:RINCON_BOUND#0",
        playbackState: "PLAYING",
      },
    });
  });

  // -------------------------------------------------------------------------
  // 8. toggle‑input‑source – render state
  // -------------------------------------------------------------------------
  it.each([
    ["x-rincon-queue:RINCON_X#0", 0, "Sonos Queue"],
    ["x-sonos-htastream:RINCON_X:spdif", 1, "Tv Input"],
    ["x-rincon-stream:RINCON_X", 2, "Line In"],
  ])(
    "toggle‑input‑source state maps URI %s to index %i and title when gated",
    (uri, expectedIdx, expectedTitle) => {
      const result = actionFunctionMap["toggle-input-source"].state.keypad({
        inActionSettings: { displayStateBasedTitle: true },
        inSonosSpeakerState: { currentURI: uri },
      });

      expect(result.stateIndex).toBe(expectedIdx);
      expect(result.title).toBe(expectedTitle);
    },
  );

  // -------------------------------------------------------------------------
  // 9. play‑next‑track & play‑previous‑track – keyDown and render
  // -------------------------------------------------------------------------
  it("play‑next‑track calls controller.next and returns empty projection", async () => {
    controller.next.mockResolvedValue(undefined);
    const result = await actionFunctionMap["play-next-track"].keyDown[0]({
      inActionSettings: { hostAddress: "h", uuid: "u" },
    });

    expect(controller.next).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: "SUCCESS", updatedSonosSpeakerState: {} });
  });

  it("play‑previous‑track calls controller.previous and returns empty projection", async () => {
    controller.previous.mockResolvedValue(undefined);
    const result = await actionFunctionMap["play-previous-track"].keyDown[0]({
      inActionSettings: { hostAddress: "h", uuid: "u" },
    });

    expect(controller.previous).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: "SUCCESS", updatedSonosSpeakerState: {} });
  });

  it.each([
    [{ displayStateBasedTitle: true }, "Next"],
    [{ displayStateBasedTitle: false }, null],
  ])(
    "play‑next‑track state renders title based on gate",
    (settings, expectedTitle) => {
      const result = actionFunctionMap["play-next-track"].state.keypad({
        inActionSettings: settings,
      });
      expect(result.title).toBe(expectedTitle);
    },
  );

  it.each([
    [{ displayStateBasedTitle: true }, "Previous"],
    [{ displayStateBasedTitle: false }, null],
  ])(
    "play‑previous‑track state renders title based on gate",
    (settings, expectedTitle) => {
      const result = actionFunctionMap["play-previous-track"].state.keypad({
        inActionSettings: settings,
      });
      expect(result.title).toBe(expectedTitle);
    },
  );
});
