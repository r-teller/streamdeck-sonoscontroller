// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let controller;
vi.mock("@/modules/actions/helpers.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, makeController: vi.fn(() => controller), raceWithTimeout: (p) => p };
});

import { actionFunctionMap, _resetActionFunctionMap } from "@/modules/plugin/actionDispatcher.js";
import { registerSonosActions, playModeCards, PLAY_MODE_DIAL_SETTLE_MS } from "@/modules/actions/sonosActions.js";
import { PLAY_MODES } from "@/modules/pi/actionSettingsSchema.js";
import { _resetCarousels, _setCanvasFactory, browseTick, CAROUSEL_LAYOUT } from "@/modules/plugin/carousel.js";
import { DIAL_DEBOUNCE_MS } from "@/modules/plugin/dialRotateDebouncer.js";

const dial = () => actionFunctionMap["encoder-play-mode"];
const settings = (extra = {}) => ({ hostAddress: "h", uuid: "u", ...extra });

beforeEach(() => {
  vi.useFakeTimers();
  _resetActionFunctionMap();
  registerSonosActions();
  _resetCarousels();
  _setCanvasFactory(() => null);
  controller = { setPlayMode: vi.fn().mockResolvedValue(undefined) };
});

afterEach(() => {
  _resetCarousels();
  vi.useRealTimers();
});

describe("encoder-play-mode registration", () => {
  it("is a carousel dial with turn, push and tap handlers and a longer settle time", () => {
    expect(dial().carousel).toBe(true);
    expect(dial().dialSettleMs).toBe(PLAY_MODE_DIAL_SETTLE_MS);
    expect(PLAY_MODE_DIAL_SETTLE_MS).toBeGreaterThan(DIAL_DEBOUNCE_MS);
    expect(dial().dialRotate).toHaveLength(1);
    expect(dial().dialDown).toHaveLength(1);
    expect(dial().touchTap).toHaveLength(1);
    expect(typeof dial().state.encoder).toBe("function");
  });
});

describe("playModeCards", () => {
  it("all modes by default, resting on the current one", () => {
    expect(playModeCards({}, { playMode: "SHUFFLE" })).toEqual({
      modes: PLAY_MODES,
      index: PLAY_MODES.indexOf("SHUFFLE"),
      current: "SHUFFLE",
    });
  });

  it("missing play mode counts as NORMAL", () => {
    expect(playModeCards({}, {}).current).toBe("NORMAL");
    expect(playModeCards({}, { playMode: "" }).index).toBe(PLAY_MODES.indexOf("NORMAL"));
  });

  it("current mode outside the subset becomes an extra first card", () => {
    const r = playModeCards({ selectedPlayModes: ["NORMAL", "SHUFFLE"] }, { playMode: "REPEAT_ONE" });
    expect(r.modes).toEqual(["REPEAT_ONE", "NORMAL", "SHUFFLE"]);
    expect(r.index).toBe(0);
  });
});

describe("encoder-play-mode dialRotate (turning stopped)", () => {
  const rotate = (state, inRotation, extra) =>
    dial().dialRotate[0]({ inContext: "c", inActionSettings: settings(extra), inSonosSpeakerState: state, inRotation });

  it("+1 and -1 step to the neighbouring modes", async () => {
    const i = PLAY_MODES.indexOf("SHUFFLE");
    expect(await rotate({ playMode: "SHUFFLE" }, 1)).toEqual({
      status: "SUCCESS",
      updatedSonosSpeakerState: { playMode: PLAY_MODES[i + 1] },
    });
    expect(await rotate({ playMode: "SHUFFLE" }, -1)).toEqual({
      status: "SUCCESS",
      updatedSonosSpeakerState: { playMode: PLAY_MODES[i - 1] },
    });
    expect(controller.setPlayMode.mock.calls).toEqual([[PLAY_MODES[i + 1]], [PLAY_MODES[i - 1]]]);
  });

  it("a burst applies the net steps in one call", async () => {
    await rotate({ playMode: "NORMAL" }, 3);
    expect(controller.setPlayMode).toHaveBeenCalledTimes(1);
    expect(controller.setPlayMode).toHaveBeenCalledWith(PLAY_MODES[wrap(PLAY_MODES.indexOf("NORMAL") + 3)]);
  });

  it("wraps past both ends", async () => {
    const last = PLAY_MODES.at(-1);
    await rotate({ playMode: last }, 1);
    expect(controller.setPlayMode).toHaveBeenLastCalledWith(PLAY_MODES[0]);
    await rotate({ playMode: PLAY_MODES[0] }, -1);
    expect(controller.setPlayMode).toHaveBeenLastCalledWith(last);
  });

  it("net zero or a full lap sends nothing", async () => {
    expect(await rotate({ playMode: "SHUFFLE" }, 0)).toEqual({ status: "SUCCESS" });
    expect(await rotate({ playMode: "SHUFFLE" }, PLAY_MODES.length)).toEqual({ status: "SUCCESS" });
    expect(controller.setPlayMode).not.toHaveBeenCalled();
  });

  it("respects the subset; a current mode outside it goes to the first (right) or last (left) allowed", async () => {
    const extra = { selectedPlayModes: ["NORMAL", "SHUFFLE", "REPEAT_ALL"] };
    await rotate({ playMode: "NORMAL" }, 1, extra);
    expect(controller.setPlayMode).toHaveBeenLastCalledWith("SHUFFLE");
    await rotate({ playMode: "REPEAT_ONE" }, 1, extra);
    expect(controller.setPlayMode).toHaveBeenLastCalledWith("NORMAL");
    await rotate({ playMode: "REPEAT_ONE" }, -1, extra);
    expect(controller.setPlayMode).toHaveBeenLastCalledWith("REPEAT_ALL");
  });

  it("speaker error -> ERROR (dispatcher shows the alert)", async () => {
    controller.setPlayMode.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await rotate({ playMode: "NORMAL" }, 1)).toEqual({ status: "ERROR" });
  });
});

describe("encoder-play-mode push and tap: next mode", () => {
  for (const event of ["dialDown", "touchTap"]) {
    it(`${event} steps to the next mode`, async () => {
      const result = await dial()[event][0]({
        inContext: "c",
        inActionSettings: settings(),
        inSonosSpeakerState: { playMode: "NORMAL" },
      });
      const next = PLAY_MODES[wrap(PLAY_MODES.indexOf("NORMAL") + 1)];
      expect(controller.setPlayMode).toHaveBeenCalledWith(next);
      expect(result).toEqual({ status: "SUCCESS", updatedSonosSpeakerState: { playMode: next } });
    });

    it(`${event} speaker error -> ERROR`, async () => {
      controller.setPlayMode.mockRejectedValue(new Error("boom"));
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await dial()[event][0]({
        inContext: "c",
        inActionSettings: settings(),
        inSonosSpeakerState: { playMode: "NORMAL" },
      });
      expect(result.status).toBe("ERROR");
    });
  }
});

describe("encoder-play-mode state (carousel)", () => {
  const render = (state, extra) =>
    dial().state.encoder({ inContext: "c", inActionSettings: settings(extra), inSonosSpeakerState: state });

  it("uses the carousel layout and centres the current mode", () => {
    const intent = render({ playMode: "REPEAT_ONE" });
    expect(intent.feedbackLayout).toBe(CAROUSEL_LAYOUT);
    expect(intent.feedback.caption).toBe("Repeat One");
    expect(intent.feedback.detail).toBe(`${PLAY_MODES.indexOf("REPEAT_ONE") + 1} / ${PLAY_MODES.length}`);
  });

  it("while browsing, shows the mode under the turned position before anything is applied", () => {
    browseTick("c", 1);
    const next = PLAY_MODES[wrap(PLAY_MODES.indexOf("NORMAL") + 1)];
    expect(render({ playMode: "NORMAL" }).feedback.caption).toBe(labelOf(next));
    expect(controller.setPlayMode).not.toHaveBeenCalled();
  });

  it("subset: only the chosen modes, plus the current one if outside", () => {
    const intent = render({ playMode: "REPEAT_ONE" }, { selectedPlayModes: ["NORMAL", "SHUFFLE"] });
    expect(intent.feedback.caption).toBe("Repeat One");
    expect(intent.feedback.detail).toBe("1 / 3");
  });
});

function wrap(i) {
  return ((i % PLAY_MODES.length) + PLAY_MODES.length) % PLAY_MODES.length;
}

function labelOf(mode) {
  return {
    NORMAL: "Normal",
    REPEAT_ALL: "Repeat All",
    REPEAT_ONE: "Repeat One",
    SHUFFLE_NOREPEAT: "Shuffle No Repeat",
    SHUFFLE: "Shuffle",
    SHUFFLE_REPEAT_ONE: "Shuffle Repeat One",
  }[mode];
}
