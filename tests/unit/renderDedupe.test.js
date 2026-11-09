/* eslint-disable max-lines-per-function */
import { vi, describe, test, expect, beforeEach } from "vitest";

const mockSd = vi.hoisted(() => ({
  setImage: vi.fn(),
  setState: vi.fn(),
  setTitle: vi.fn(),
  setFeedback: vi.fn(),
  setFeedbackLayout: vi.fn(),
}));

vi.mock("@/modules/common/sdConnect.js", () => ({
  getStreamDeckClient: () => mockSd,
}));

import { refreshStateAndTitle, clearDedupeCache } from "@/modules/plugin/renderDedupe.js";
import { setActionSettings, deleteActionSettings, actionSettings } from "@/modules/plugin/actionSettings.js";
import { actionFunctionMap, _resetActionFunctionMap } from "@/modules/plugin/actionDispatcher.js";

describe("renderDedupe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetActionFunctionMap();
    Object.keys(actionSettings).forEach((k) => deleteActionSettings(k));
  });

  test("identical renders dedupe to single emission per field", () => {
    const intent = {
      imageDataURL: "img.png",
      stateIndex: 2,
      title: "Song",
    };
    actionFunctionMap["currently-playing"] = {
      state: { default: () => intent },
    };
    setActionSettings("ctx1", {
      action: "com.r-teller.sonoscontroller.currently-playing",
      controller: "Keypad",
      status: {},
    });

    for (let i = 0; i < 60; i++) {
      refreshStateAndTitle({ inContext: "ctx1", inSonosSpeakerState: {} });
    }

    expect(mockSd.setImage).toHaveBeenCalledTimes(1);
    expect(mockSd.setState).toHaveBeenCalledTimes(1);
    expect(mockSd.setTitle).toHaveBeenCalledTimes(1);
  });

  test("state change re-sends image and title (Stream Deck sets them per state, sonos-1vd)", () => {
    let stateIdx = 1;
    actionFunctionMap["currently-playing"] = {
      state: {
        default: () => ({
          imageDataURL: "img.png",
          stateIndex: stateIdx,
          title: "Song",
        }),
      },
    };
    setActionSettings("ctx2", {
      action: "com.r-teller.sonoscontroller.currently-playing",
      controller: "Keypad",
      status: {},
    });

    // first render – all three fields emit
    refreshStateAndTitle({ inContext: "ctx2", inSonosSpeakerState: {} });

    // change only stateIndex: the new state starts with its default image/title, so both re-send
    stateIdx = 2;
    refreshStateAndTitle({ inContext: "ctx2", inSonosSpeakerState: {} });

    expect(mockSd.setState).toHaveBeenCalledTimes(2);
    expect(mockSd.setImage).toHaveBeenCalledTimes(2);
    expect(mockSd.setTitle).toHaveBeenCalledTimes(2);
    // setState goes out before the image so the image lands on the new state
    expect(mockSd.setState.mock.invocationCallOrder[1]).toBeLessThan(mockSd.setImage.mock.invocationCallOrder[1]);

    // nothing changed: no re-emission
    refreshStateAndTitle({ inContext: "ctx2", inSonosSpeakerState: {} });
    expect(mockSd.setImage).toHaveBeenCalledTimes(2);
    expect(mockSd.setTitle).toHaveBeenCalledTimes(2);
  });

  test("feedback shallow equality – full payload on change, no duplicate on shallow equal", () => {
    let feedback = { a: 1, b: 2 };
    actionFunctionMap["encoder-audio-equalizer"] = {
      state: {
        default: () => ({ feedback }),
      },
    };
    setActionSettings("ctx3", {
      action: "com.r-teller.sonoscontroller.encoder-audio-equalizer",
      controller: "Encoder",
      status: {},
    });

    // first render
    refreshStateAndTitle({ inContext: "ctx3", inSonosSpeakerState: {} });
    // second render – new object, same values
    feedback = { a: 1, b: 2 };
    refreshStateAndTitle({ inContext: "ctx3", inSonosSpeakerState: {} });
    // third render – changed value
    feedback = { a: 1, b: 3 };
    refreshStateAndTitle({ inContext: "ctx3", inSonosSpeakerState: {} });

    expect(mockSd.setFeedback).toHaveBeenCalledTimes(2);
    const thirdCallPayload = mockSd.setFeedback.mock.calls[1][0].payload;
    expect(thirdCallPayload).toEqual({ a: 1, b: 3 });
  });

  test("dial values are sent after the layout, and re-sent when the layout changes (sonos-280)", () => {
    let layout = "./layouts/encoder-bar-0-100.json";
    actionFunctionMap["encoder-audio-equalizer"] = {
      state: { default: () => ({ feedbackLayout: layout, feedback: { title: "Volume", value: 23, indicator: 23 } }) },
    };
    setActionSettings("dial", {
      action: "com.r-teller.sonoscontroller.encoder-audio-equalizer",
      controller: "Encoder",
      status: {},
    });

    refreshStateAndTitle({ inContext: "dial", inSonosSpeakerState: {} });
    expect(mockSd.setFeedbackLayout).toHaveBeenCalledTimes(1);
    expect(mockSd.setFeedback).toHaveBeenCalledTimes(1);
    // a layout resets the strip, so values must land after it
    expect(mockSd.setFeedbackLayout.mock.invocationCallOrder[0]).toBeLessThan(mockSd.setFeedback.mock.invocationCallOrder[0]);

    // same values, same layout: nothing re-sent
    refreshStateAndTitle({ inContext: "dial", inSonosSpeakerState: {} });
    expect(mockSd.setFeedback).toHaveBeenCalledTimes(1);

    // layout changes with identical values: values are re-sent onto the new layout
    layout = "./layouts/encoder-gbar-10-10.json";
    refreshStateAndTitle({ inContext: "dial", inSonosSpeakerState: {} });
    expect(mockSd.setFeedbackLayout).toHaveBeenCalledTimes(2);
    expect(mockSd.setFeedback).toHaveBeenCalledTimes(2);
  });

  test("feedbackLayout swap – emits on change only", () => {
    let layout = "./layouts/encoder-bar-0-100.json";
    actionFunctionMap["encoder-audio-equalizer"] = {
      state: {
        default: () => ({ feedbackLayout: layout }),
      },
    };
    setActionSettings("ctx4", {
      action: "com.r-teller.sonoscontroller.encoder-audio-equalizer",
      controller: "Encoder",
      status: {},
    });

    // first layout
    refreshStateAndTitle({ inContext: "ctx4", inSonosSpeakerState: {} });
    // change layout
    layout = "./layouts/encoder-gbar-10-10.json";
    refreshStateAndTitle({ inContext: "ctx4", inSonosSpeakerState: {} });
    // same layout again – should not emit
    refreshStateAndTitle({ inContext: "ctx4", inSonosSpeakerState: {} });

    expect(mockSd.setFeedbackLayout).toHaveBeenCalledTimes(2);
    expect(mockSd.setFeedbackLayout.mock.calls[0][0].payload).toEqual({ layout: "./layouts/encoder-bar-0-100.json" });
    expect(mockSd.setFeedbackLayout.mock.calls[1][0].payload).toEqual({ layout: "./layouts/encoder-gbar-10-10.json" });
  });

  test("force flag bypasses dedupe", () => {
    const intent = {
      imageDataURL: "img.png",
      stateIndex: 5,
      title: "Forced",
    };
    actionFunctionMap["currently-playing"] = {
      state: { default: () => intent },
    };
    setActionSettings("ctx5", {
      action: "com.r-teller.sonoscontroller.currently-playing",
      controller: "Keypad",
      status: {},
    });

    // first render – emits
    refreshStateAndTitle({ inContext: "ctx5", inSonosSpeakerState: {} });
    // second identical render – no new emissions
    refreshStateAndTitle({ inContext: "ctx5", inSonosSpeakerState: {} });
    // force render – should emit again
    refreshStateAndTitle({
      inContext: "ctx5",
      inSonosSpeakerState: {},
      force: true,
    });

    expect(mockSd.setImage).toHaveBeenCalledTimes(2);
    expect(mockSd.setState).toHaveBeenCalledTimes(2);
    expect(mockSd.setTitle).toHaveBeenCalledTimes(2);
  });

  test("marquee carve‑out behavior", () => {
    let call = 0;
    const titles = ["AAA", "BBB", "CCC", "DDD", "EEE"];
    actionFunctionMap["currently-playing"] = {
      state: {
        default: () => {
          const title = titles[call] ?? "ZZZ";
          const source = call < 5 ? "Song A" : "Song B";
          call++;
          return { title, titleSource: source };
        },
      },
    };
    setActionSettings("ctx6", {
      action: "com.r-teller.sonoscontroller.currently-playing",
      controller: "Keypad",
      status: {},
    });

    // 5 marquee frames – same source, different titles
    for (let i = 0; i < 5; i++) {
      refreshStateAndTitle({ inContext: "ctx6", inSonosSpeakerState: {} });
    }
    expect(mockSd.setTitle).toHaveBeenCalledTimes(5);

    // source changes – still emits
    refreshStateAndTitle({ inContext: "ctx6", inSonosSpeakerState: {} });
    expect(mockSd.setTitle).toHaveBeenCalledTimes(6);

    // static intent (no titleSource)
    actionFunctionMap["currently-playing"] = {
      state: { default: () => ({ title: "Static", titleSource: null }) },
    };
    refreshStateAndTitle({ inContext: "ctx6", inSonosSpeakerState: {} });
    refreshStateAndTitle({ inContext: "ctx6", inSonosSpeakerState: {} });
    expect(mockSd.setTitle).toHaveBeenCalledTimes(7); // only first static emits

    // back to marquee after static – should emit again
    call = 0;
    actionFunctionMap["currently-playing"] = {
      state: {
        default: () => ({
          title: "NEW",
          titleSource: "Song C",
        }),
      },
    };
    refreshStateAndTitle({ inContext: "ctx6", inSonosSpeakerState: {} });
    expect(mockSd.setTitle).toHaveBeenCalledTimes(8);
  });

  test("clearDedupeCache works for unknown and known contexts", () => {
    const intent = { imageDataURL: "img.png", title: "ClearTest" };
    actionFunctionMap["currently-playing"] = {
      state: { default: () => intent },
    };
    setActionSettings("ctx7", {
      action: "com.r-teller.sonoscontroller.currently-playing",
      controller: "Keypad",
      status: {},
    });

    // first render – emits
    refreshStateAndTitle({ inContext: "ctx7", inSonosSpeakerState: {} });
    // second identical render – no new emit
    refreshStateAndTitle({ inContext: "ctx7", inSonosSpeakerState: {} });
    expect(mockSd.setImage).toHaveBeenCalledTimes(1);
    expect(mockSd.setTitle).toHaveBeenCalledTimes(1);

    // clear unknown – should not throw
    expect(() => clearDedupeCache("unknown-ctx")).not.toThrow();

    // clear known and render again – should emit anew
    clearDedupeCache("ctx7");
    refreshStateAndTitle({ inContext: "ctx7", inSonosSpeakerState: {} });
    expect(mockSd.setImage).toHaveBeenCalledTimes(2);
    expect(mockSd.setTitle).toHaveBeenCalledTimes(2);
  });

  test("gracefully handles missing settings, unknown short name, and missing state fn", () => {
    // missing settings
    expect(() => refreshStateAndTitle({ inContext: "no-settings", inSonosSpeakerState: {} })).not.toThrow();

    // unknown short name
    setActionSettings("ctx8", {
      action: "com.r-teller.sonoscontroller.unknown-action",
      controller: "Keypad",
      status: {},
    });
    expect(() => refreshStateAndTitle({ inContext: "ctx8", inSonosSpeakerState: {} })).not.toThrow();

    // known short name but no state fn
    actionFunctionMap["currently-playing"] = { state: {} };
    setActionSettings("ctx9", {
      action: "com.r-teller.sonoscontroller.currently-playing",
      controller: "Keypad",
      status: {},
    });
    expect(() => refreshStateAndTitle({ inContext: "ctx9", inSonosSpeakerState: {} })).not.toThrow();

    // ensure no emissions occurred
    expect(mockSd.setImage).toHaveBeenCalledTimes(0);
    expect(mockSd.setState).toHaveBeenCalledTimes(0);
    expect(mockSd.setTitle).toHaveBeenCalledTimes(0);
    expect(mockSd.setFeedback).toHaveBeenCalledTimes(0);
    expect(mockSd.setFeedbackLayout).toHaveBeenCalledTimes(0);
  });
});
