import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { callAction, _resetActionFunctionMap, actionFunctionMap } from "@/modules/plugin/actionDispatcher.js";
import { addContext, getSpeaker, getAllSpeakers, setOperationalStatus } from "@/modules/plugin/SonosSpeakers.js";
import { OPERATIONAL_STATUS } from "@/modules/plugin/operationalStatus.js";

vi.useFakeTimers();

describe("actionDispatcher", () => {
  const ctx = "ctx1";
  const uuid = "uuid-1";
  const actionSettings = {
    [ctx]: {
      action: "com.rteller.toggle-mute-unmute",
      uuid,
    },
  };
  let showAlert;

  beforeEach(() => {
    // reset speaker store
    const all = getAllSpeakers();
    for (const k of Object.keys(all)) delete all[k];
    addContext({ UUID: uuid, context: ctx, hostAddress: "host" });

    // reset action map
    _resetActionFunctionMap();

    // spy on console.warn
    vi.spyOn(console, "warn").mockImplementation(() => {});

    showAlert = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("unknown context (no settings) does not throw and warns", async () => {
    await callAction({ inContext: "unknown", inEvent: "keyDown", inRotation: 0 }, { actionSettings, showAlert });
    expect(console.warn).toHaveBeenCalledWith(`[actionDispatcher] No settings for context: unknown`);
    const speaker = getSpeaker({ UUID: uuid });
    expect(speaker.operationalStatus).toBe(OPERATIONAL_STATUS.UNINITIALIZED);
  });

  test("unknown short name warns and does nothing", async () => {
    const badSettings = {
      [ctx]: { action: "com.x.bogus", uuid },
    };
    await callAction({ inContext: ctx, inEvent: "keyDown", inRotation: 0 }, { actionSettings: badSettings, showAlert });
    expect(console.warn).toHaveBeenCalledWith(`[actionDispatcher] Unknown action: com.x.bogus`);
    const speaker = getSpeaker({ UUID: uuid });
    expect(speaker.operationalStatus).toBe(OPERATIONAL_STATUS.UNINITIALIZED);
  });

  test("missing uuid in settings warns and does nothing", async () => {
    const missingUuidSettings = {
      [ctx]: { action: "com.rteller.toggle-mute-unmute" },
    };
    await callAction({ inContext: ctx, inEvent: "keyDown", inRotation: 0 }, { actionSettings: missingUuidSettings, showAlert });
    expect(console.warn).toHaveBeenCalledWith(`[actionDispatcher] Missing UUID in settings for context: ${ctx}`);
    const speaker = getSpeaker({ UUID: uuid });
    expect(speaker.operationalStatus).toBe(OPERATIONAL_STATUS.UNINITIALIZED);
  });

  test("empty handler list returns silently, speaker status unchanged", async () => {
    await callAction({ inContext: ctx, inEvent: "keyDown", inRotation: 0 }, { actionSettings, showAlert });
    const speaker = getSpeaker({ UUID: uuid });
    expect(speaker.operationalStatus).toBe(OPERATIONAL_STATUS.UNINITIALIZED);
    expect(showAlert).not.toHaveBeenCalled();
  });

  test("RATE_LIMITED soft-drop: handler not called, status RATE_LIMITED, no alert", async () => {
    // simulate three recent UPDATING attempts
    setOperationalStatus({ UUID: uuid, operationalStatus: OPERATIONAL_STATUS.UPDATING });
    setOperationalStatus({ UUID: uuid, operationalStatus: OPERATIONAL_STATUS.UPDATING });
    setOperationalStatus({ UUID: uuid, operationalStatus: OPERATIONAL_STATUS.UPDATING });
    // set back to UPDATED (attempts stay)
    getSpeaker({ UUID: uuid }).operationalStatus = OPERATIONAL_STATUS.UPDATED;

    const handler = vi.fn().mockResolvedValue({ status: "OK" });
    actionFunctionMap["toggle-mute-unmute"].keyDown.push(handler);

    await callAction({ inContext: ctx, inEvent: "keyDown", inRotation: 0 }, { actionSettings, showAlert });

    // handler should not be invoked because next attempt becomes RATE_LIMITED
    expect(handler).not.toHaveBeenCalled();
    const speaker = getSpeaker({ UUID: uuid });
    expect(speaker.operationalStatus).toBe(OPERATIONAL_STATUS.RATE_LIMITED);
    expect(showAlert).not.toHaveBeenCalled();
  });

  test("handler returning {status: 'ERROR'} leads to DISCONNECTED and alert", async () => {
    const handler = vi.fn().mockResolvedValue({ status: "ERROR", message: "bad" });
    actionFunctionMap["toggle-mute-unmute"].keyDown.push(handler);

    await callAction({ inContext: ctx, inEvent: "keyDown", inRotation: 0 }, { actionSettings, showAlert });

    expect(handler).toHaveBeenCalled();
    const speaker = getSpeaker({ UUID: uuid });
    expect(speaker.operationalStatus).toBe(OPERATIONAL_STATUS.DISCONNECTED);
    expect(showAlert).toHaveBeenCalledTimes(1);
    expect(showAlert).toHaveBeenCalledWith({ context: ctx });
  });

  test("handler returning falsy leads to DISCONNECTED and alert", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    actionFunctionMap["toggle-mute-unmute"].keyDown.push(handler);

    await callAction({ inContext: ctx, inEvent: "keyDown", inRotation: 0 }, { actionSettings, showAlert });

    const speaker = getSpeaker({ UUID: uuid });
    expect(speaker.operationalStatus).toBe(OPERATIONAL_STATUS.DISCONNECTED);
    expect(showAlert).toHaveBeenCalledTimes(1);
  });

  test("handler throwing leads to DISCONNECTED and alert", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("boom"));
    actionFunctionMap["toggle-mute-unmute"].keyDown.push(handler);

    await callAction({ inContext: ctx, inEvent: "keyDown", inRotation: 0 }, { actionSettings, showAlert });

    const speaker = getSpeaker({ UUID: uuid });
    expect(speaker.operationalStatus).toBe(OPERATIONAL_STATUS.DISCONNECTED);
    expect(showAlert).toHaveBeenCalledTimes(1);
  });

  test("successful handler with updatedSonosSpeakerState merges state, schedules an immediate re-poll, status UPDATED", async () => {
    const handler = vi.fn().mockResolvedValue({
      status: "OK",
      updatedSonosSpeakerState: { playMode: "NEW_MODE", muted: true },
    });
    actionFunctionMap["toggle-mute-unmute"].keyDown.push(handler);

    const speakerBefore = getSpeaker({ UUID: uuid });
    expect(speakerBefore.lastChecked).toBeNull();

    await callAction({ inContext: ctx, inEvent: "keyDown", inRotation: 0 }, { actionSettings, showAlert });

    const speakerAfter = getSpeaker({ UUID: uuid });
    expect(speakerAfter.state.playMode).toBe("NEW_MODE");
    expect(speakerAfter.state.muted).toBe(true);
    // lastChecked reset so the next tick confirms the projection; lastUpdated untouched (sonos-e9y)
    expect(speakerAfter.lastChecked).toBe(0);
    expect(speakerAfter.lastUpdated).toBeNull();
    // the action bumps the state version so overlapping polls drop their results
    expect(speakerAfter.stateVersion).toBe(2);
    expect(speakerAfter.operationalStatus).toBe(OPERATIONAL_STATUS.UPDATED);
  });

  test("sequential multi-handler await order is preserved", async () => {
    const order = [];
    const handler1 = vi.fn().mockImplementation(async () => {
      order.push("h1-start");
      await Promise.resolve(); // microtask
      order.push("h1-end");
      return { status: "OK" };
    });
    const handler2 = vi.fn().mockImplementation(async () => {
      order.push("h2-start");
      await Promise.resolve();
      order.push("h2-end");
      return { status: "OK" };
    });
    actionFunctionMap["toggle-mute-unmute"].keyDown.push(handler1, handler2);

    await callAction({ inContext: ctx, inEvent: "keyDown", inRotation: 0 }, { actionSettings, showAlert });

    expect(order).toEqual(["h1-start", "h1-end", "h2-start", "h2-end"]);
    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
    const speaker = getSpeaker({ UUID: uuid });
    expect(speaker.operationalStatus).toBe(OPERATIONAL_STATUS.UPDATED);
  });

  test("inRotation is passed through for dialRotate event", async () => {
    const handler = vi.fn().mockResolvedValue({ status: "OK" });
    actionFunctionMap["toggle-mute-unmute"].dialRotate.push(handler);

    await callAction({ inContext: ctx, inEvent: "dialRotate", inRotation: 42 }, { actionSettings, showAlert });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        inRotation: 42,
        inContext: ctx,
        inActionSettings: actionSettings[ctx],
        inSonosSpeakerState: expect.any(Object),
      }),
    );
  });
});
