import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  sonosSpeakers,
  addContext,
  setOperationalStatus,
} from "@/modules/plugin/SonosSpeakers.js";
import { OPERATIONAL_STATUS } from "@/modules/plugin/operationalStatus.js";
import {
  actionFunctionMap,
  callAction,
  _resetActionFunctionMap,
} from "@/modules/plugin/actionDispatcher.js";

const PREFIX = "com.r-teller.sonoscontroller.";

const ACTION_SHORT_NAMES = [
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
  "encoder-audio-equalizer",
];

function clearStore() {
  for (const k of Object.keys(sonosSpeakers)) delete sonosSpeakers[k];
}

describe("actionDispatcher — registry shape (etr.4 AC)", () => {
  beforeEach(() => _resetActionFunctionMap());

  it("AC: actionFunctionMap exports an entry for each of the 11 action short-names", () => {
    expect(Object.keys(actionFunctionMap).sort()).toEqual([...ACTION_SHORT_NAMES].sort());
  });

  it("AC: each entry has keyDown/dialRotate/dialDown/touchTap arrays + state object", () => {
    for (const name of ACTION_SHORT_NAMES) {
      const entry = actionFunctionMap[name];
      expect(entry.keyDown).toEqual([]);
      expect(entry.dialRotate).toEqual([]);
      expect(entry.dialDown).toEqual([]);
      expect(entry.touchTap).toEqual([]);
      expect(entry.state).toEqual({ default: null, keypad: null, encoder: null });
    }
  });

  it("AC dev: Phase 5 can register a handler by mutating the slot directly", () => {
    const fn = vi.fn();
    actionFunctionMap["toggle-mute-unmute"].keyDown.push(fn);
    expect(actionFunctionMap["toggle-mute-unmute"].keyDown).toContain(fn);
  });
});

describe("actionDispatcher — callAction safety (etr.4 AC)", () => {
  beforeEach(() => {
    clearStore();
    _resetActionFunctionMap();
  });

  it("AC: unknown context — no actionSettings entry — does NOT throw", async () => {
    await expect(
      callAction({ inContext: "ctx-ghost", inEvent: "keyDown" }, { actionSettings: {} }),
    ).resolves.toBeUndefined();
  });

  it("AC: action short-name not in registry — does NOT throw", async () => {
    const settings = {
      "ctx-1": { action: PREFIX + "made-up-action", uuid: "RINCON_A" },
    };
    await expect(
      callAction({ inContext: "ctx-1", inEvent: "keyDown" }, { actionSettings: settings }),
    ).resolves.toBeUndefined();
  });

  it("empty handler slot is a no-op — no status mutation", async () => {
    addContext({ UUID: "RINCON_A", context: "ctx-1", hostAddress: "1.1.1.1" });
    const settings = {
      "ctx-1": { action: PREFIX + "toggle-mute-unmute", uuid: "RINCON_A" },
    };
    await callAction(
      { inContext: "ctx-1", inEvent: "keyDown" },
      { actionSettings: settings },
    );
    // Operational status untouched (no UPDATING transition).
    expect(sonosSpeakers["RINCON_A"].operationalStatus).toBe(
      OPERATIONAL_STATUS.UNINITIALIZED,
    );
  });
});

describe("actionDispatcher — success path (etr.4 AC)", () => {
  beforeEach(() => {
    clearStore();
    _resetActionFunctionMap();
  });

  it("AC: SUCCESS handler triggers updateSpeakerState merge AND flips to UPDATED", async () => {
    addContext({ UUID: "RINCON_A", context: "ctx-1", hostAddress: "1.1.1.1" });
    const handler = vi.fn(async () => ({
      status: "SUCCESS",
      updatedSonosSpeakerState: { muted: true },
    }));
    actionFunctionMap["toggle-mute-unmute"].keyDown.push(handler);

    const settings = {
      "ctx-1": { action: PREFIX + "toggle-mute-unmute", uuid: "RINCON_A" },
    };
    await callAction(
      { inContext: "ctx-1", inEvent: "keyDown" },
      { actionSettings: settings },
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(sonosSpeakers["RINCON_A"].state.muted).toBe(true);
    expect(sonosSpeakers["RINCON_A"].operationalStatus).toBe(
      OPERATIONAL_STATUS.UPDATED,
    );
  });

  it("AC: optimistic update does NOT bump lastChecked (next supervisor tick still re-fetches)", async () => {
    addContext({ UUID: "RINCON_A", context: "ctx-1", hostAddress: "1.1.1.1" });
    const handler = vi.fn(async () => ({
      status: "SUCCESS",
      updatedSonosSpeakerState: { muted: true },
    }));
    actionFunctionMap["toggle-mute-unmute"].keyDown.push(handler);
    const settings = {
      "ctx-1": { action: PREFIX + "toggle-mute-unmute", uuid: "RINCON_A" },
    };

    await callAction(
      { inContext: "ctx-1", inEvent: "keyDown" },
      { actionSettings: settings },
    );

    expect(sonosSpeakers["RINCON_A"].lastChecked).toBe(null);
    expect(sonosSpeakers["RINCON_A"].lastUpdated).toBe(null);
  });

  it("handler receives inContext/inActionSettings/inSonosSpeakerState/inRotation", async () => {
    addContext({ UUID: "RINCON_A", context: "ctx-1", hostAddress: "1.1.1.1" });
    sonosSpeakers["RINCON_A"].state = { muted: false };
    const handler = vi.fn(async () => ({ status: "SUCCESS", updatedSonosSpeakerState: {} }));
    actionFunctionMap["encoder-audio-equalizer"].dialRotate.push(handler);
    const settings = {
      "ctx-1": { action: PREFIX + "encoder-audio-equalizer", uuid: "RINCON_A" },
    };

    await callAction(
      { inContext: "ctx-1", inEvent: "dialRotate", inRotation: 5 },
      { actionSettings: settings },
    );

    expect(handler).toHaveBeenCalledWith({
      inContext: "ctx-1",
      inActionSettings: settings["ctx-1"],
      inSonosSpeakerState: { muted: false },
      inRotation: 5,
    });
  });
});

describe("actionDispatcher — failure path (etr.4 AC)", () => {
  beforeEach(() => {
    clearStore();
    _resetActionFunctionMap();
  });

  it("AC: handler returning {status: 'ERROR'} flips to DISCONNECTED + showAlert on EVERY context", async () => {
    addContext({ UUID: "RINCON_A", context: "ctx-1", hostAddress: "1.1.1.1" });
    addContext({ UUID: "RINCON_A", context: "ctx-2" });
    addContext({ UUID: "RINCON_A", context: "ctx-3" });
    actionFunctionMap["toggle-mute-unmute"].keyDown.push(async () => ({ status: "ERROR" }));
    const showAlert = vi.fn();

    const settings = {
      "ctx-1": { action: PREFIX + "toggle-mute-unmute", uuid: "RINCON_A" },
    };
    await callAction(
      { inContext: "ctx-1", inEvent: "keyDown" },
      { actionSettings: settings, showAlert },
    );

    expect(sonosSpeakers["RINCON_A"].operationalStatus).toBe(
      OPERATIONAL_STATUS.DISCONNECTED,
    );
    expect(showAlert).toHaveBeenCalledTimes(3);
    const ctxsCalled = showAlert.mock.calls.map((c) => c[0].context).sort();
    expect(ctxsCalled).toEqual(["ctx-1", "ctx-2", "ctx-3"]);
  });

  it("AC: handler that throws also takes the failure branch", async () => {
    addContext({ UUID: "RINCON_A", context: "ctx-1", hostAddress: "1.1.1.1" });
    actionFunctionMap["toggle-mute-unmute"].keyDown.push(async () => {
      throw new Error("boom");
    });
    const showAlert = vi.fn();
    const settings = {
      "ctx-1": { action: PREFIX + "toggle-mute-unmute", uuid: "RINCON_A" },
    };

    await callAction(
      { inContext: "ctx-1", inEvent: "keyDown" },
      { actionSettings: settings, showAlert },
    );

    expect(sonosSpeakers["RINCON_A"].operationalStatus).toBe(
      OPERATIONAL_STATUS.DISCONNECTED,
    );
    expect(showAlert).toHaveBeenCalledTimes(1);
  });
});

describe("actionDispatcher — RATE_LIMITED soft-drop (etr.4 AC)", () => {
  beforeEach(() => {
    clearStore();
    _resetActionFunctionMap();
  });

  it("AC: RATE_LIMITED on entry — handler is NOT invoked", async () => {
    addContext({ UUID: "RINCON_A", context: "ctx-1", hostAddress: "1.1.1.1" });
    // Burn the rate-limit budget BEFORE callAction — its UPDATING bump trips
    // RATE_LIMITED, and the dispatcher must abort silently.
    for (let i = 0; i < 3; i++) {
      setOperationalStatus({
        UUID: "RINCON_A",
        operationalStatus: OPERATIONAL_STATUS.UPDATING,
      });
    }
    const handler = vi.fn(async () => ({
      status: "SUCCESS",
      updatedSonosSpeakerState: {},
    }));
    actionFunctionMap["toggle-mute-unmute"].keyDown.push(handler);

    const settings = {
      "ctx-1": { action: PREFIX + "toggle-mute-unmute", uuid: "RINCON_A" },
    };
    await callAction(
      { inContext: "ctx-1", inEvent: "keyDown" },
      { actionSettings: settings },
    );

    expect(handler).not.toHaveBeenCalled();
    expect(sonosSpeakers["RINCON_A"].operationalStatus).toBe(
      OPERATIONAL_STATUS.RATE_LIMITED,
    );
  });
});

describe("actionDispatcher — short-name extraction (etr.4 AC)", () => {
  beforeEach(() => {
    clearStore();
    _resetActionFunctionMap();
  });

  it("AC: extracts short-name via action.split('.').pop() — works for any namespace prefix", async () => {
    addContext({ UUID: "RINCON_A", context: "ctx-1", hostAddress: "1.1.1.1" });
    const handler = vi.fn(async () => ({
      status: "SUCCESS",
      updatedSonosSpeakerState: {},
    }));
    actionFunctionMap["toggle-mute-unmute"].keyDown.push(handler);

    // Use a non-standard prefix to verify split('.').pop() behavior.
    const settings = {
      "ctx-1": {
        action: "future.namespace.change.toggle-mute-unmute",
        uuid: "RINCON_A",
      },
    };
    await callAction(
      { inContext: "ctx-1", inEvent: "keyDown" },
      { actionSettings: settings },
    );
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
