import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter as NodeEventEmitter } from "node:events";

// @elgato/streamdeck reads manifest.json at import time. Stub it before
// importing anything that transitively imports the SDK (sdConnect.js does).
vi.mock("@elgato/streamdeck", () => ({ EventEmitter: NodeEventEmitter }));

import {
  actionFunctionMap,
  _resetActionFunctionMap,
} from "@/modules/plugin/actionDispatcher.js";
import {
  actionSettings,
  setActionSettings,
} from "@/modules/plugin/actionSettings.js";
import {
  refreshStateAndTitle,
  clearDedupeCache,
} from "@/modules/plugin/renderDedupe.js";

const PREFIX = "com.r-teller.sonoscontroller.";

function clearAllSettings() {
  for (const k of Object.keys(actionSettings)) delete actionSettings[k];
}

function makeFakeClient() {
  return {
    setImage: vi.fn(),
    setState: vi.fn(),
    setTitle: vi.fn(),
    setFeedback: vi.fn(),
    setFeedbackLayout: vi.fn(),
  };
}

describe("renderDedupe — basic field dedupe (etr.7 AC)", () => {
  beforeEach(() => {
    _resetActionFunctionMap();
    clearAllSettings();
  });

  it("AC: setImage emitted on first call; suppressed on identical second call", () => {
    actionFunctionMap["toggle-mute-unmute"].state.keypad = () => ({
      imageDataURL: "data:image/png;base64,abc",
    });
    setActionSettings("ctx-1", {
      action: PREFIX + "toggle-mute-unmute",
      controller: "Keypad",
      status: {},
    });
    const client = makeFakeClient();

    refreshStateAndTitle(
      { inContext: "ctx-1", inSonosSpeakerState: {} },
      { getClient: () => client },
    );
    expect(client.setImage).toHaveBeenCalledTimes(1);

    refreshStateAndTitle(
      { inContext: "ctx-1", inSonosSpeakerState: {} },
      { getClient: () => client },
    );
    expect(client.setImage).toHaveBeenCalledTimes(1); // still 1 — deduped
  });

  it("AC: setState emitted only when stateIndex changes", () => {
    let stateIndex = 0;
    actionFunctionMap["toggle-mute-unmute"].state.keypad = () => ({
      stateIndex,
    });
    setActionSettings("ctx-1", {
      action: PREFIX + "toggle-mute-unmute",
      controller: "Keypad",
      status: {},
    });
    const client = makeFakeClient();

    refreshStateAndTitle(
      { inContext: "ctx-1", inSonosSpeakerState: {} },
      { getClient: () => client },
    );
    expect(client.setState).toHaveBeenCalledTimes(1);

    refreshStateAndTitle(
      { inContext: "ctx-1", inSonosSpeakerState: {} },
      { getClient: () => client },
    );
    expect(client.setState).toHaveBeenCalledTimes(1);

    stateIndex = 1;
    refreshStateAndTitle(
      { inContext: "ctx-1", inSonosSpeakerState: {} },
      { getClient: () => client },
    );
    expect(client.setState).toHaveBeenCalledTimes(2);
    expect(client.setState).toHaveBeenLastCalledWith({ context: "ctx-1", stateIndex: 1 });
  });

  it("AC: stable state — 60 successive identical renders → one push, then zero", () => {
    actionFunctionMap["toggle-mute-unmute"].state.keypad = () => ({
      stateIndex: 0,
      title: "Office",
    });
    setActionSettings("ctx-1", {
      action: PREFIX + "toggle-mute-unmute",
      controller: "Keypad",
      status: {},
    });
    const client = makeFakeClient();

    for (let i = 0; i < 60; i++) {
      refreshStateAndTitle(
        { inContext: "ctx-1", inSonosSpeakerState: {} },
        { getClient: () => client },
      );
    }

    expect(client.setState).toHaveBeenCalledTimes(1);
    expect(client.setTitle).toHaveBeenCalledTimes(1);
  });
});

describe("renderDedupe — setFeedback per-field (etr.7 AC)", () => {
  beforeEach(() => {
    _resetActionFunctionMap();
    clearAllSettings();
  });

  it("AC: setFeedback emitted on first call; suppressed on identical second call", () => {
    actionFunctionMap["encoder-audio-equalizer"].state.encoder = () => ({
      feedback: { title: "Volume", value: 50, icon: null, indicator: 50 },
    });
    setActionSettings("ctx-1", {
      action: PREFIX + "encoder-audio-equalizer",
      controller: "Encoder",
      status: {},
    });
    const client = makeFakeClient();

    refreshStateAndTitle(
      { inContext: "ctx-1", inSonosSpeakerState: {} },
      { getClient: () => client },
    );
    refreshStateAndTitle(
      { inContext: "ctx-1", inSonosSpeakerState: {} },
      { getClient: () => client },
    );
    expect(client.setFeedback).toHaveBeenCalledTimes(1);
  });

  it("AC: when a single field changes (volume 50 → 51), exactly one setFeedback emits with the full new payload", () => {
    let value = 50;
    actionFunctionMap["encoder-audio-equalizer"].state.encoder = () => ({
      feedback: { title: "Volume", value, indicator: value },
    });
    setActionSettings("ctx-1", {
      action: PREFIX + "encoder-audio-equalizer",
      controller: "Encoder",
      status: {},
    });
    const client = makeFakeClient();

    refreshStateAndTitle(
      { inContext: "ctx-1", inSonosSpeakerState: {} },
      { getClient: () => client },
    );
    expect(client.setFeedback).toHaveBeenCalledTimes(1);

    value = 51;
    refreshStateAndTitle(
      { inContext: "ctx-1", inSonosSpeakerState: {} },
      { getClient: () => client },
    );
    expect(client.setFeedback).toHaveBeenCalledTimes(2);
    expect(client.setFeedback.mock.calls[1][0].payload).toEqual({
      title: "Volume",
      value: 51,
      indicator: 51,
    });
  });
});

describe("renderDedupe — setFeedbackLayout (etr.7 AC)", () => {
  beforeEach(() => {
    _resetActionFunctionMap();
    clearAllSettings();
  });

  it("AC: setFeedbackLayout emitted only when layout name changes", () => {
    let layout = "./layouts/encoder-bar-0-100.json";
    actionFunctionMap["encoder-audio-equalizer"].state.encoder = () => ({
      feedbackLayout: layout,
    });
    setActionSettings("ctx-1", {
      action: PREFIX + "encoder-audio-equalizer",
      controller: "Encoder",
      status: {},
    });
    const client = makeFakeClient();

    refreshStateAndTitle(
      { inContext: "ctx-1", inSonosSpeakerState: {} },
      { getClient: () => client },
    );
    refreshStateAndTitle(
      { inContext: "ctx-1", inSonosSpeakerState: {} },
      { getClient: () => client },
    );
    expect(client.setFeedbackLayout).toHaveBeenCalledTimes(1);

    layout = "./layouts/encoder-gbar-10-10.json";
    refreshStateAndTitle(
      { inContext: "ctx-1", inSonosSpeakerState: {} },
      { getClient: () => client },
    );
    expect(client.setFeedbackLayout).toHaveBeenCalledTimes(2);
  });
});

describe("renderDedupe — marquee carve-out (etr.7 AC)", () => {
  beforeEach(() => {
    _resetActionFunctionMap();
    clearAllSettings();
  });

  it("AC: when titleSource is provided, per-frame substring still pushes through to setTitle (animation continues)", () => {
    let frame = 0;
    actionFunctionMap["currently-playing"].state.keypad = () => ({
      title: ["Sym", "ymp", "mph", "pho"][frame],
      titleSource: "Symphony No. 9",
    });
    setActionSettings("ctx-1", {
      action: PREFIX + "currently-playing",
      controller: "Keypad",
      status: {},
    });
    const client = makeFakeClient();

    for (frame = 0; frame < 4; frame++) {
      refreshStateAndTitle(
        { inContext: "ctx-1", inSonosSpeakerState: {} },
        { getClient: () => client },
      );
    }

    // All 4 frames pushed despite identical titleSource — animation
    // continues per the carve-out.
    expect(client.setTitle).toHaveBeenCalledTimes(4);
  });

  it("AC: when titleSource changes (track changed), the new source is treated as a fresh push", () => {
    let titleSource = "Symphony No. 9";
    actionFunctionMap["currently-playing"].state.keypad = () => ({
      title: titleSource.slice(0, 3),
      titleSource,
    });
    setActionSettings("ctx-1", {
      action: PREFIX + "currently-playing",
      controller: "Keypad",
      status: {},
    });
    const client = makeFakeClient();

    refreshStateAndTitle(
      { inContext: "ctx-1", inSonosSpeakerState: {} },
      { getClient: () => client },
    );
    titleSource = "New Track";
    refreshStateAndTitle(
      { inContext: "ctx-1", inSonosSpeakerState: {} },
      { getClient: () => client },
    );

    expect(client.setTitle).toHaveBeenCalledTimes(2);
    expect(actionSettings["ctx-1"].status.lastTitleSource).toBe("New Track");
  });
});

describe("renderDedupe — force flag (etr.7 AC)", () => {
  beforeEach(() => {
    _resetActionFunctionMap();
    clearAllSettings();
  });

  it("AC: force=true re-emits every field even when cache matches", () => {
    actionFunctionMap["currently-playing"].state.keypad = () => ({
      stateIndex: 0,
      title: "Office",
      imageDataURL: "data:img",
    });
    setActionSettings("ctx-1", {
      action: PREFIX + "currently-playing",
      controller: "Keypad",
      status: {},
    });
    const client = makeFakeClient();

    refreshStateAndTitle(
      { inContext: "ctx-1", inSonosSpeakerState: {} },
      { getClient: () => client },
    );
    refreshStateAndTitle(
      { inContext: "ctx-1", inSonosSpeakerState: {}, force: true },
      { getClient: () => client },
    );

    expect(client.setState).toHaveBeenCalledTimes(2);
    expect(client.setTitle).toHaveBeenCalledTimes(2);
    expect(client.setImage).toHaveBeenCalledTimes(2);
  });
});

describe("renderDedupe — cache lifecycle (etr.7 AC)", () => {
  beforeEach(() => {
    _resetActionFunctionMap();
    clearAllSettings();
  });

  it("AC: clearDedupeCache resets status; next render re-emits all fields", () => {
    actionFunctionMap["toggle-mute-unmute"].state.keypad = () => ({
      stateIndex: 0,
      title: "Office",
    });
    setActionSettings("ctx-1", {
      action: PREFIX + "toggle-mute-unmute",
      controller: "Keypad",
      status: {},
    });
    const client = makeFakeClient();

    refreshStateAndTitle(
      { inContext: "ctx-1", inSonosSpeakerState: {} },
      { getClient: () => client },
    );
    expect(client.setState).toHaveBeenCalledTimes(1);

    clearDedupeCache("ctx-1");

    refreshStateAndTitle(
      { inContext: "ctx-1", inSonosSpeakerState: {} },
      { getClient: () => client },
    );
    expect(client.setState).toHaveBeenCalledTimes(2);
    expect(client.setTitle).toHaveBeenCalledTimes(2);
  });

  it("safe no-op: refreshStateAndTitle for unknown context does not throw", () => {
    const client = makeFakeClient();
    expect(() =>
      refreshStateAndTitle(
        { inContext: "ctx-ghost", inSonosSpeakerState: {} },
        { getClient: () => client },
      ),
    ).not.toThrow();
    expect(client.setState).not.toHaveBeenCalled();
  });

  it("safe no-op: action without registered state function does not throw or emit", () => {
    setActionSettings("ctx-1", {
      action: PREFIX + "toggle-mute-unmute",
      controller: "Keypad",
      status: {},
    });
    const client = makeFakeClient();
    refreshStateAndTitle(
      { inContext: "ctx-1", inSonosSpeakerState: {} },
      { getClient: () => client },
    );
    expect(client.setState).not.toHaveBeenCalled();
  });
});
