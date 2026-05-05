import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

// @elgato/streamdeck reads manifest.json at import time. Stub it before
// importing modules that transitively import the SDK.
vi.mock("@elgato/streamdeck", () => ({ EventEmitter }));
import {
  sonosSpeakers,
  getSpeaker,
} from "@/modules/plugin/SonosSpeakers.js";
import {
  actionSettings,
  getActionSettings,
} from "@/modules/plugin/actionSettings.js";
import { globalSettings } from "@/modules/plugin/globalSettings.js";
import { wireLifecycleHandlers } from "@/modules/plugin/lifecycle.js";

const PREFIX = "com.r-teller.sonoscontroller.";

function clearStore() {
  for (const k of Object.keys(sonosSpeakers)) delete sonosSpeakers[k];
  for (const k of Object.keys(actionSettings)) delete actionSettings[k];
  globalSettings.value = {};
}

function makeFakeSd() {
  return new EventEmitter();
}

describe("lifecycle — willAppear (etr.5 AC)", () => {
  beforeEach(() => clearStore());

  it("AC: willAppear with payload.settings.uuid registers the context with the speaker", () => {
    const sd = makeFakeSd();
    wireLifecycleHandlers({ sd });

    sd.emit("willAppear", {
      action: PREFIX + "toggle-mute-unmute",
      context: "ctx-1",
      payload: {
        controller: "Keypad",
        state: 0,
        settings: {
          uuid: "RINCON_X",
          hostAddress: "1.1.1.1",
          zoneName: "Office",
        },
      },
    });

    expect(getActionSettings("ctx-1")).toMatchObject({
      action: PREFIX + "toggle-mute-unmute",
      controller: "Keypad",
      currentStateIndex: 0,
      uuid: "RINCON_X",
      hostAddress: "1.1.1.1",
      zoneName: "Office",
      status: {},
    });
    expect(getSpeaker({ UUID: "RINCON_X" }).contexts).toContain("ctx-1");
  });

  it("AC: payload.state defaults to 0 when undefined; preserved when explicit 2", () => {
    const sd = makeFakeSd();
    wireLifecycleHandlers({ sd });

    sd.emit("willAppear", {
      action: PREFIX + "toggle-mute-unmute",
      context: "ctx-default",
      payload: { controller: "Keypad", settings: { uuid: "RINCON_A" } },
    });
    sd.emit("willAppear", {
      action: PREFIX + "toggle-mute-unmute",
      context: "ctx-state2",
      payload: {
        controller: "Keypad",
        state: 2,
        settings: { uuid: "RINCON_B" },
      },
    });

    expect(getActionSettings("ctx-default").currentStateIndex).toBe(0);
    expect(getActionSettings("ctx-state2").currentStateIndex).toBe(2);
  });

  it("willAppear without uuid does not touch sonosSpeakers", () => {
    const sd = makeFakeSd();
    wireLifecycleHandlers({ sd });

    sd.emit("willAppear", {
      action: PREFIX + "currently-playing",
      context: "ctx-no-binding",
      payload: { controller: "Keypad", settings: {} },
    });

    expect(getActionSettings("ctx-no-binding")).toBeDefined();
    expect(Object.keys(sonosSpeakers)).toHaveLength(0);
  });
});

describe("lifecycle — willDisappear (etr.5 AC)", () => {
  beforeEach(() => clearStore());

  it("AC: willDisappear removes the context from the speaker AND drops actionSettings", () => {
    const sd = makeFakeSd();
    wireLifecycleHandlers({ sd });

    sd.emit("willAppear", {
      action: PREFIX + "toggle-mute-unmute",
      context: "ctx-1",
      payload: { controller: "Keypad", settings: { uuid: "RINCON_X" } },
    });
    sd.emit("willDisappear", { context: "ctx-1", payload: {} });

    expect(getActionSettings("ctx-1")).toBeUndefined();
    // Last context — speaker was deleted entirely.
    expect(sonosSpeakers["RINCON_X"]).toBeUndefined();
  });

  it("AC: willDisappear on one of two contexts leaves the speaker and the OTHER context", () => {
    const sd = makeFakeSd();
    wireLifecycleHandlers({ sd });

    sd.emit("willAppear", {
      action: PREFIX + "toggle-mute-unmute",
      context: "ctx-1",
      payload: { controller: "Keypad", settings: { uuid: "RINCON_X" } },
    });
    sd.emit("willAppear", {
      action: PREFIX + "currently-playing",
      context: "ctx-2",
      payload: { controller: "Keypad", settings: { uuid: "RINCON_X" } },
    });
    sd.emit("willDisappear", { context: "ctx-1", payload: {} });

    expect(sonosSpeakers["RINCON_X"]).toBeDefined();
    expect(sonosSpeakers["RINCON_X"].contexts).toEqual(["ctx-2"]);
    expect(getActionSettings("ctx-1")).toBeUndefined();
    expect(getActionSettings("ctx-2")).toBeDefined();
  });
});

describe("lifecycle — didReceiveSettings (etr.5 AC)", () => {
  beforeEach(() => clearStore());

  it("AC: UUID change → moveContext atomically (old loses ctx; new gains ctx)", () => {
    const sd = makeFakeSd();
    wireLifecycleHandlers({ sd });

    sd.emit("willAppear", {
      action: PREFIX + "toggle-mute-unmute",
      context: "ctx-1",
      payload: { controller: "Keypad", settings: { uuid: "RINCON_OLD" } },
    });

    sd.emit("didReceiveSettings", {
      context: "ctx-1",
      payload: {
        settings: {
          uuid: "RINCON_NEW",
          hostAddress: "10.0.0.5",
          zoneName: "Kitchen",
        },
      },
    });

    expect(sonosSpeakers["RINCON_OLD"]).toBeUndefined();
    expect(sonosSpeakers["RINCON_NEW"].contexts).toContain("ctx-1");
    expect(getActionSettings("ctx-1").uuid).toBe("RINCON_NEW");
  });

  it("AC: same UUID, other settings change → updates cache, no speaker mutation", () => {
    const sd = makeFakeSd();
    wireLifecycleHandlers({ sd });

    sd.emit("willAppear", {
      action: PREFIX + "volume-up",
      context: "ctx-1",
      payload: {
        controller: "Keypad",
        settings: { uuid: "RINCON_X", adjustVolumeIncrement: 5 },
      },
    });

    sd.emit("didReceiveSettings", {
      context: "ctx-1",
      payload: {
        settings: { uuid: "RINCON_X", adjustVolumeIncrement: 7 },
      },
    });

    expect(getActionSettings("ctx-1").adjustVolumeIncrement).toBe(7);
    // Speaker untouched — still has the same single context.
    expect(sonosSpeakers["RINCON_X"].contexts).toEqual(["ctx-1"]);
  });

  it("AC: didReceiveSettings preserves the existing status object on the cached settings", () => {
    const sd = makeFakeSd();
    wireLifecycleHandlers({ sd });

    sd.emit("willAppear", {
      action: PREFIX + "toggle-mute-unmute",
      context: "ctx-1",
      payload: { controller: "Keypad", settings: { uuid: "RINCON_X" } },
    });
    // Render dedupe (etr.7) writes into status — simulate that.
    actionSettings["ctx-1"].status = { lastTitleValue: "Office" };

    sd.emit("didReceiveSettings", {
      context: "ctx-1",
      payload: { settings: { uuid: "RINCON_X" } },
    });

    expect(getActionSettings("ctx-1").status).toEqual({ lastTitleValue: "Office" });
  });
});

describe("lifecycle — globalsettings (etr.5 AC)", () => {
  beforeEach(() => clearStore());

  it("AC: globalsettings event mirrors payload into globalSettings.value", () => {
    const sd = makeFakeSd();
    wireLifecycleHandlers({ sd });

    sd.emit("globalsettings", {
      deviceCheckInterval: 15,
      deviceTimeoutDuration: 8,
      adjustVolumeIncrement: 5,
    });

    expect(globalSettings.value).toEqual({
      deviceCheckInterval: 15,
      deviceTimeoutDuration: 8,
      adjustVolumeIncrement: 5,
    });
  });
});

describe("lifecycle — input event routing (etr.5 AC)", () => {
  beforeEach(() => clearStore());

  it("AC: keyDown / dialDown / touchTap route to callAction with correct inEvent", () => {
    const sd = makeFakeSd();
    const callAction = vi.fn();
    const handleDialRotate = vi.fn();
    wireLifecycleHandlers({ sd }, { callAction, handleDialRotate });

    sd.emit("keyDown", { context: "ctx-1" });
    sd.emit("dialDown", { context: "ctx-2" });
    sd.emit("touchTap", { context: "ctx-3" });

    expect(callAction).toHaveBeenCalledWith({ inContext: "ctx-1", inEvent: "keyDown" });
    expect(callAction).toHaveBeenCalledWith({ inContext: "ctx-2", inEvent: "dialDown" });
    expect(callAction).toHaveBeenCalledWith({ inContext: "ctx-3", inEvent: "touchTap" });
  });

  it("AC: dialRotate routes to handleDialRotate with ticks (etr.6)", () => {
    const sd = makeFakeSd();
    const callAction = vi.fn();
    const handleDialRotate = vi.fn();
    wireLifecycleHandlers({ sd }, { callAction, handleDialRotate });

    sd.emit("dialRotate", { context: "ctx-1", payload: { ticks: 3 } });

    expect(handleDialRotate).toHaveBeenCalledWith({ context: "ctx-1", ticks: 3 });
    expect(callAction).not.toHaveBeenCalled();
  });

  it("AC: keyUp and dialUp are NOT subscribed (no listeners registered)", () => {
    const sd = makeFakeSd();
    wireLifecycleHandlers({ sd });
    expect(sd.listenerCount("keyUp")).toBe(0);
    expect(sd.listenerCount("dialUp")).toBe(0);
  });
});

describe("lifecycle — teardown (etr.5 AC)", () => {
  beforeEach(() => clearStore());

  it("AC: teardown removes every listener — repeated mount/unmount does not stack", () => {
    const sd = makeFakeSd();
    const teardown1 = wireLifecycleHandlers({ sd });
    const teardown2 = wireLifecycleHandlers({ sd });
    expect(sd.listenerCount("willAppear")).toBe(2);

    teardown1();
    teardown2();

    expect(sd.listenerCount("willAppear")).toBe(0);
    expect(sd.listenerCount("willDisappear")).toBe(0);
    expect(sd.listenerCount("didReceiveSettings")).toBe(0);
    expect(sd.listenerCount("globalsettings")).toBe(0);
    expect(sd.listenerCount("systemDidWakeUp")).toBe(0);
    expect(sd.listenerCount("keyDown")).toBe(0);
    expect(sd.listenerCount("dialDown")).toBe(0);
    expect(sd.listenerCount("touchTap")).toBe(0);
    expect(sd.listenerCount("dialRotate")).toBe(0);
  });
});

describe("lifecycle — systemDidWakeUp (etr.5 AC)", () => {
  beforeEach(() => clearStore());

  it("AC: systemDidWakeUp does NOT throw and does NOT force an immediate fetch", () => {
    const sd = makeFakeSd();
    wireLifecycleHandlers({ sd });
    // Pre-populate a stale speaker; verify the handler doesn't reset it.
    sd.emit("willAppear", {
      action: PREFIX + "toggle-mute-unmute",
      context: "ctx-1",
      payload: { controller: "Keypad", settings: { uuid: "RINCON_X" } },
    });
    sonosSpeakers["RINCON_X"].lastChecked = 0;

    expect(() => sd.emit("systemDidWakeUp", {})).not.toThrow();
    // The handler is intentionally a no-op — supervisor handles re-convergence.
    expect(sonosSpeakers["RINCON_X"].lastChecked).toBe(0);
  });
});
