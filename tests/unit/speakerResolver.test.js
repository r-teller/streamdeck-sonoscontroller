// Speaker resolution + binding reconciliation (sonos-lb3, sonos-bpt, sonos-l07).
// Fixture mirrors the real case: Office speaker replaced, .78 (old id) -> .80 (new id).
import { describe, test, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

import { resolveSpeaker, isBindingMissing, findRoomSpeaker } from "@/modules/common/speakerResolver.js";
import { reconcileBindings, summarizeBindings } from "@/modules/plugin/bindingReconciler.js";
import { withResolvedSpeaker } from "@/modules/plugin/actionDispatcher.js";
import { wireLifecycleHandlers } from "@/modules/plugin/lifecycle.js";
import { startPollingSupervisor } from "@/modules/plugin/pollingSupervisor.js";
import { getAllSpeakers, addContext, getSpeaker } from "@/modules/plugin/SonosSpeakers.js";
import { actionSettings, setActionSettings } from "@/modules/plugin/actionSettings.js";
import { setGlobalSettings } from "@/modules/plugin/globalSettings.js";
import { buildGlobalSettingsPayload, cleanReplacements } from "@/modules/pi/globalSettingsSchema.js";

const OLD = "RINCON_OFFICEOLD01400";
const NEW = "RINCON_OFFICENEW01400";
const KITCHEN = "RINCON_KITCHEN01400";

const dev = (uuid, zoneName, hostAddress, isSatellite = false) => ({ uuid, zoneName, hostAddress, isSatellite });
const household = (...list) => Object.fromEntries(list.map((d) => [d.uuid, d]));
const officeOld = { uuid: OLD, hostAddress: "192.168.50.78", zoneName: "Office" };

beforeEach(() => {
  const all = getAllSpeakers();
  for (const k of Object.keys(all)) delete all[k];
  for (const k of Object.keys(actionSettings)) delete actionSettings[k];
  setGlobalSettings({});
});

describe("resolveSpeaker", () => {
  test("uses the discovered device when the id is known, picking up a new IP", () => {
    const globals = { devices: household(dev(OLD, "Office", "192.168.50.99")) };
    expect(resolveSpeaker(officeOld, globals)).toEqual({
      uuid: OLD,
      hostAddress: "192.168.50.99",
      zoneName: "Office",
      source: "device",
    });
  });

  test("follows an explicit replacement before falling back to room name", () => {
    const globals = {
      devices: household(dev(NEW, "Office", "192.168.50.80"), dev(KITCHEN, "Kitchen", "192.168.50.41")),
      speakerReplacements: { [OLD]: KITCHEN },
    };
    const r = resolveSpeaker(officeOld, globals);
    expect(r.source).toBe("replacement");
    expect(r.uuid).toBe(KITCHEN);
  });

  test("follows replacement chains and ignores loops", () => {
    const devices = household(dev(NEW, "Den", "10.0.0.2"));
    expect(resolveSpeaker(officeOld, { devices, speakerReplacements: { [OLD]: "MID", MID: NEW } }).uuid).toBe(NEW);
    const loop = resolveSpeaker(officeOld, { devices, speakerReplacements: { [OLD]: "MID", MID: OLD } });
    expect(loop.source).toBe("saved");
  });

  test("matches by room name when exactly one non-satellite speaker is in the room", () => {
    const globals = {
      devices: household(dev(NEW, "Office", "192.168.50.80"), dev("SAT", "Office", "192.168.50.81", true)),
    };
    const r = resolveSpeaker(officeOld, globals);
    expect(r).toMatchObject({ uuid: NEW, hostAddress: "192.168.50.80", source: "room" });
  });

  test("an ambiguous room is not auto-resolved", () => {
    const devices = household(dev(NEW, "Office", "192.168.50.80"), dev("OTHER", "Office", "192.168.50.82"));
    expect(findRoomSpeaker("Office", devices)).toBeNull();
    expect(resolveSpeaker(officeOld, { devices }).source).toBe("saved");
  });

  test("falls back to the saved values when nothing matches", () => {
    expect(resolveSpeaker(officeOld, {})).toEqual({ ...officeOld, source: "saved" });
    expect(resolveSpeaker({}, {}).source).toBe("saved");
  });

  test("isBindingMissing only when the household is known and nothing resolves", () => {
    expect(isBindingMissing(officeOld, {})).toBe(false);
    expect(isBindingMissing(officeOld, { devices: household(dev(KITCHEN, "Kitchen", "1.1.1.1")) })).toBe(true);
    expect(isBindingMissing(officeOld, { devices: household(dev(NEW, "Office", "1.1.1.2")) })).toBe(false);
  });
});

describe("global settings schema", () => {
  test("keeps valid replacements and drops junk", () => {
    expect(cleanReplacements({ a: "b", c: "c", d: 5, "": "x" })).toEqual({ a: "b" });
    expect(buildGlobalSettingsPayload({ speakerReplacements: { [OLD]: NEW } }).speakerReplacements).toEqual({
      [OLD]: NEW,
    });
  });
});

describe("withResolvedSpeaker (dispatcher)", () => {
  test("returns the same object when nothing changes", () => {
    const s = { ...officeOld, action: "x" };
    expect(withResolvedSpeaker(s, {})).toBe(s);
  });

  test("points handlers at the replacement speaker", () => {
    const s = { ...officeOld, action: "x" };
    const out = withResolvedSpeaker(s, { devices: household(dev(NEW, "Office", "192.168.50.80")) });
    expect(out).toMatchObject({ uuid: NEW, hostAddress: "192.168.50.80", action: "x" });
    expect(s.uuid).toBe(OLD);
  });
});

describe("reconcileBindings", () => {
  test("rewrites on-screen buttons to the resolved speaker and moves the registry entry", () => {
    setActionSettings("c1", { ...officeOld, action: "a", title: "Office (192.168.50.78)", status: {}, currentStateIndex: 1 });
    setActionSettings("c2", { uuid: KITCHEN, hostAddress: "192.168.50.41", zoneName: "Kitchen", status: {} });
    addContext({ UUID: OLD, context: "c1", hostAddress: "192.168.50.78", zoneName: "Office" });
    addContext({ UUID: KITCHEN, context: "c2", hostAddress: "192.168.50.41", zoneName: "Kitchen" });
    setGlobalSettings({
      devices: household(dev(NEW, "Office", "192.168.50.80"), dev(KITCHEN, "Kitchen", "192.168.50.41")),
    });
    const sd = { saveSettings: vi.fn() };
    const clearDedupeCache = vi.fn();

    expect(reconcileBindings({ sd, clearDedupeCache })).toEqual(["c1"]);

    expect(sd.saveSettings).toHaveBeenCalledTimes(1);
    const saved = sd.saveSettings.mock.calls[0][0];
    expect(saved.context).toBe("c1");
    expect(saved.actionSettings).toMatchObject({ uuid: NEW, hostAddress: "192.168.50.80", title: "Office (192.168.50.80)" });
    expect(saved.actionSettings).not.toHaveProperty("status");
    expect(saved.actionSettings).not.toHaveProperty("currentStateIndex");
    expect(actionSettings.c1.uuid).toBe(NEW);
    expect(getAllSpeakers()[OLD]).toBeUndefined();
    expect(getAllSpeakers()[NEW].contexts).toEqual(["c1"]);
    expect(clearDedupeCache).toHaveBeenCalledWith("c1");
  });

  test("updates the polling host when only the IP changed", () => {
    setActionSettings("c1", { ...officeOld });
    addContext({ UUID: OLD, context: "c1", hostAddress: "192.168.50.78", zoneName: "Office" });
    setGlobalSettings({ devices: household(dev(OLD, "Office", "192.168.50.90")) });
    reconcileBindings({ sd: { saveSettings: vi.fn() } });
    expect(getSpeaker({ UUID: OLD }).hostAddress).toBe("192.168.50.90");
  });

  test("leaves unresolved bindings untouched", () => {
    setActionSettings("c1", { ...officeOld });
    setGlobalSettings({ devices: household(dev(KITCHEN, "Kitchen", "1.1.1.1")) });
    const sd = { saveSettings: vi.fn() };
    expect(reconcileBindings({ sd })).toEqual([]);
    expect(sd.saveSettings).not.toHaveBeenCalled();
  });

  test("summarizeBindings groups and counts by speaker", () => {
    setActionSettings("a", { ...officeOld });
    setActionSettings("b", { ...officeOld });
    setActionSettings("c", { uuid: NEW, hostAddress: "192.168.50.80", zoneName: "Office" });
    setActionSettings("d", { action: "unbound" });
    expect(summarizeBindings()).toEqual([
      { uuid: OLD, zoneName: "Office", hostAddress: "192.168.50.78", buttons: 2 },
      { uuid: NEW, zoneName: "Office", hostAddress: "192.168.50.80", buttons: 1 },
    ]);
  });
});

describe("lifecycle wiring", () => {
  const createSd = () => {
    const sd = new EventEmitter();
    sd.showAlert = vi.fn();
    sd.saveSettings = vi.fn();
    sd.sendToPropertyInspector = vi.fn();
    return sd;
  };
  const deps = () => ({ callAction: vi.fn(), handleDialRotate: vi.fn(), clearDedupeCache: vi.fn() });

  test("same-uuid settings change with a new IP updates the polling host (sonos-l07)", () => {
    const sd = createSd();
    const teardown = wireLifecycleHandlers({ sd }, deps());
    sd.emit("willAppear", { action: "a", context: "c1", payload: { settings: { ...officeOld } } });
    sd.emit("didReceiveSettings", { context: "c1", payload: { settings: { ...officeOld, hostAddress: "192.168.50.80" } } });
    expect(getSpeaker({ UUID: OLD }).hostAddress).toBe("192.168.50.80");
    teardown();
  });

  test("global settings change reconciles buttons and pushes bindings to the open PI", () => {
    const sd = createSd();
    const teardown = wireLifecycleHandlers({ sd }, deps());
    sd.emit("willAppear", { action: "a", context: "c1", payload: { settings: { ...officeOld } } });
    sd.emit("sendToPlugin", { action: "a", context: "pi-ctx", payload: { type: "getBindings" } });
    expect(sd.sendToPropertyInspector).toHaveBeenLastCalledWith({
      action: "a",
      context: "pi-ctx",
      payload: { type: "bindings", bindings: [{ uuid: OLD, zoneName: "Office", hostAddress: "192.168.50.78", buttons: 1 }] },
    });

    sd.emit("globalsettings", {
      devices: household(dev(NEW, "Office", "192.168.50.80")),
    });
    expect(actionSettings.c1.uuid).toBe(NEW);
    expect(sd.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ context: "c1" }));
    expect(sd.sendToPropertyInspector.mock.lastCall[0].payload.bindings).toEqual([
      { uuid: NEW, zoneName: "Office", hostAddress: "192.168.50.80", buttons: 1 },
    ]);

    sd.emit("propertyInspectorDidDisappear", { context: "pi-ctx" });
    sd.sendToPropertyInspector.mockClear();
    sd.emit("globalsettings", { devices: household(dev(NEW, "Office", "192.168.50.80")) });
    expect(sd.sendToPropertyInspector).not.toHaveBeenCalled();
    teardown();
  });

  test("willAppear repairs a button whose speaker was replaced", () => {
    setGlobalSettings({ devices: household(dev(NEW, "Office", "192.168.50.80")) });
    const sd = createSd();
    const teardown = wireLifecycleHandlers({ sd }, deps());
    sd.emit("willAppear", { action: "a", context: "c9", payload: { settings: { ...officeOld } } });
    expect(actionSettings.c9).toMatchObject({ uuid: NEW, hostAddress: "192.168.50.80" });
    expect(getAllSpeakers()[NEW].contexts).toContain("c9");
    teardown();
  });
});

describe("polling resolves the host per poll", () => {
  test("polls the replacement speaker", async () => {
    vi.useFakeTimers();
    addContext({ UUID: OLD, context: "c1", hostAddress: "192.168.50.78", zoneName: "Office" });
    const rejecting = () => Promise.reject(new Error("offline"));
    const controllerFactory = vi.fn(() => ({
      getTransportSettings: rejecting,
      getTransportInfo: rejecting,
      getMute: rejecting,
      getVolume: rejecting,
      getBass: rejecting,
      getTreble: rejecting,
      getPositionInfo: rejecting,
    }));
    const stop = startPollingSupervisor({
      intervalMs: 500,
      controllerFactory,
      getGlobals: () => ({ devices: {}, speakerReplacements: {} }),
    });
    await vi.advanceTimersByTimeAsync(600);
    expect(controllerFactory).toHaveBeenLastCalledWith("192.168.50.78", OLD);
    stop();

    getSpeaker({ UUID: OLD }).lastChecked = null;
    const stop2 = startPollingSupervisor({
      intervalMs: 500,
      controllerFactory,
      getGlobals: () => ({ devices: household(dev(NEW, "Office", "192.168.50.80")), speakerReplacements: { [OLD]: NEW } }),
    });
    await vi.advanceTimersByTimeAsync(600);
    expect(controllerFactory).toHaveBeenLastCalledWith("192.168.50.80", NEW);
    stop2();
    vi.useRealTimers();
  });
});
