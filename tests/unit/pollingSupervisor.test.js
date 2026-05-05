import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  sonosSpeakers,
  addContext,
  getSpeaker,
  setOperationalStatus,
} from "@/modules/plugin/SonosSpeakers.js";
import { OPERATIONAL_STATUS } from "@/modules/plugin/operationalStatus.js";
import {
  pollSpeaker,
  startPollingSupervisor,
  SUPERVISOR_TICK_MS,
} from "@/modules/plugin/pollingSupervisor.js";

function clearStore() {
  for (const key of Object.keys(sonosSpeakers)) {
    delete sonosSpeakers[key];
  }
}

function makeFakeController({ delayMs = 0, throwOnCall = null } = {}) {
  const result = {
    getTransportSettings: vi.fn(async () => ({ playMode: "NORMAL" })),
    getTransportInfo: vi.fn(async () => ({ playbackState: "PLAYING" })),
    getMute: vi.fn(async () => false),
    getVolume: vi.fn(async () => 50),
    getBass: vi.fn(async () => 0),
    getTreble: vi.fn(async () => 0),
    getPositionInfo: vi.fn(async () => ({
      title: "Track",
      artist: "Artist",
      album: "Album",
      albumArtURI: "/getaa",
      trackURI: "x-rincon-queue:RINCON_X#0",
    })),
  };
  if (delayMs > 0) {
    for (const k of Object.keys(result)) {
      const orig = result[k];
      result[k] = vi.fn(
        () =>
          new Promise((resolve) => setTimeout(() => resolve(orig()), delayMs)),
      );
    }
  }
  if (throwOnCall) {
    result[throwOnCall] = vi.fn(async () => {
      throw new Error("simulated SOAP failure");
    });
  }
  return result;
}

describe("pollingSupervisor — pollSpeaker happy path (etr.3 AC)", () => {
  beforeEach(() => clearStore());

  it("AC: 7-call fan-out merges into speaker.state and flips to UPDATED", async () => {
    addContext({
      UUID: "RINCON_A",
      context: "ctx-1",
      hostAddress: "192.168.1.10",
      zoneName: "Office",
    });
    const controller = makeFakeController();
    await pollSpeaker({
      uuid: "RINCON_A",
      speaker: sonosSpeakers["RINCON_A"],
      deviceTimeoutDurationSeconds: 5,
      controllerFactory: () => controller,
    });

    const speaker = getSpeaker({ UUID: "RINCON_A" });
    expect(speaker.operationalStatus).toBe(OPERATIONAL_STATUS.UPDATED);
    expect(speaker.state.playMode).toBe("NORMAL");
    expect(speaker.state.muted).toBe(false);
    expect(speaker.state.audioEqualizer).toEqual({ volume: 50, bass: 0, treble: 0 });
    expect(speaker.state.playing.title).toBe("Track");
    expect(speaker.state.currentURI).toBe("x-rincon-queue:RINCON_X#0");
    expect(speaker.lastChecked).not.toBe(null);
    expect(speaker.lastUpdated).not.toBe(null);

    // All 7 SOAP getters fired once each.
    expect(controller.getTransportSettings).toHaveBeenCalledTimes(1);
    expect(controller.getTransportInfo).toHaveBeenCalledTimes(1);
    expect(controller.getMute).toHaveBeenCalledTimes(1);
    expect(controller.getVolume).toHaveBeenCalledTimes(1);
    expect(controller.getBass).toHaveBeenCalledTimes(1);
    expect(controller.getTreble).toHaveBeenCalledTimes(1);
    expect(controller.getPositionInfo).toHaveBeenCalledTimes(1);
  });

  it("AC: each fetch uses a freshly constructed SonosController (factory called per fetch)", async () => {
    addContext({ UUID: "RINCON_A", context: "ctx-1", hostAddress: "1.1.1.1" });
    const factory = vi.fn(() => makeFakeController());
    await pollSpeaker({
      uuid: "RINCON_A",
      speaker: sonosSpeakers["RINCON_A"],
      deviceTimeoutDurationSeconds: 5,
      controllerFactory: factory,
    });
    await pollSpeaker({
      uuid: "RINCON_A",
      speaker: sonosSpeakers["RINCON_A"],
      deviceTimeoutDurationSeconds: 5,
      controllerFactory: factory,
    });
    expect(factory).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenCalledWith("1.1.1.1");
  });

  it("AC: invokes refreshStateAndTitle once per bound context after a successful fetch", async () => {
    addContext({ UUID: "RINCON_A", context: "ctx-1", hostAddress: "1.1.1.1" });
    addContext({ UUID: "RINCON_A", context: "ctx-2" });
    addContext({ UUID: "RINCON_A", context: "ctx-3" });
    const refresh = vi.fn();
    await pollSpeaker({
      uuid: "RINCON_A",
      speaker: sonosSpeakers["RINCON_A"],
      deviceTimeoutDurationSeconds: 5,
      controllerFactory: () => makeFakeController(),
      refreshStateAndTitle: refresh,
    });
    expect(refresh).toHaveBeenCalledTimes(3);
    const contextsCalled = refresh.mock.calls.map((c) => c[0].inContext).sort();
    expect(contextsCalled).toEqual(["ctx-1", "ctx-2", "ctx-3"]);
  });
});

describe("pollingSupervisor — pollSpeaker failure path (etr.3 AC)", () => {
  beforeEach(() => {
    clearStore();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("AC: thrown exception flips speaker to DISCONNECTED and showAlert fires once per context", async () => {
    addContext({ UUID: "RINCON_A", context: "ctx-1", hostAddress: "1.1.1.1" });
    addContext({ UUID: "RINCON_A", context: "ctx-2" });
    const showAlert = vi.fn();

    await pollSpeaker({
      uuid: "RINCON_A",
      speaker: sonosSpeakers["RINCON_A"],
      deviceTimeoutDurationSeconds: 5,
      controllerFactory: () => makeFakeController({ throwOnCall: "getMute" }),
      showAlert,
    });

    expect(getSpeaker({ UUID: "RINCON_A" }).operationalStatus).toBe(
      OPERATIONAL_STATUS.DISCONNECTED,
    );
    expect(showAlert).toHaveBeenCalledTimes(2);
    expect(showAlert).toHaveBeenCalledWith({ context: "ctx-1" });
    expect(showAlert).toHaveBeenCalledWith({ context: "ctx-2" });
  });

  it("AC: SOAP hang longer than timeout takes the failure branch", async () => {
    addContext({ UUID: "RINCON_A", context: "ctx-1", hostAddress: "1.1.1.1" });
    const showAlert = vi.fn();
    // Each call delayed 30s — well past the 5s budget.
    const controller = makeFakeController({ delayMs: 30_000 });

    const promise = pollSpeaker({
      uuid: "RINCON_A",
      speaker: sonosSpeakers["RINCON_A"],
      deviceTimeoutDurationSeconds: 5,
      controllerFactory: () => controller,
      showAlert,
    });

    await vi.advanceTimersByTimeAsync(6_000);
    await promise;

    expect(getSpeaker({ UUID: "RINCON_A" }).operationalStatus).toBe(
      OPERATIONAL_STATUS.DISCONNECTED,
    );
    expect(showAlert).toHaveBeenCalledTimes(1);
  });

  it("AC: failure branch does NOT update lastChecked/lastUpdated (keeps speaker due for next tick)", async () => {
    addContext({ UUID: "RINCON_A", context: "ctx-1", hostAddress: "1.1.1.1" });
    await pollSpeaker({
      uuid: "RINCON_A",
      speaker: sonosSpeakers["RINCON_A"],
      deviceTimeoutDurationSeconds: 5,
      controllerFactory: () => makeFakeController({ throwOnCall: "getMute" }),
      showAlert: () => {},
    });
    const speaker = sonosSpeakers["RINCON_A"];
    expect(speaker.lastChecked).toBe(null);
    expect(speaker.lastUpdated).toBe(null);
  });
});

describe("pollingSupervisor — rate-limit interaction (etr.3 + etr.2)", () => {
  beforeEach(() => clearStore());

  it("rate-limited speaker: pollSpeaker aborts after the trip without fetching", async () => {
    addContext({ UUID: "RINCON_A", context: "ctx-1", hostAddress: "1.1.1.1" });
    // Burn through the rate-limit budget BEFORE pollSpeaker so the trip happens
    // on entry. The 4th UPDATING from etr.2 trips RATE_LIMITED.
    for (let i = 0; i < 3; i++) {
      setOperationalStatus({
        UUID: "RINCON_A",
        operationalStatus: OPERATIONAL_STATUS.UPDATING,
      });
    }
    const controller = makeFakeController();

    await pollSpeaker({
      uuid: "RINCON_A",
      speaker: sonosSpeakers["RINCON_A"],
      deviceTimeoutDurationSeconds: 5,
      controllerFactory: () => controller,
    });

    expect(getSpeaker({ UUID: "RINCON_A" }).operationalStatus).toBe(
      OPERATIONAL_STATUS.RATE_LIMITED,
    );
    expect(controller.getMute).not.toHaveBeenCalled();
  });
});

describe("pollingSupervisor — startPollingSupervisor cadence (etr.3 AC)", () => {
  beforeEach(() => {
    clearStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T00:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("exports SUPERVISOR_TICK_MS = 500", () => {
    expect(SUPERVISOR_TICK_MS).toBe(500);
  });

  it("AC: speaker with lastChecked=12s ago is fetched; 4s ago is skipped", async () => {
    addContext({ UUID: "RINCON_DUE", context: "ctx-1", hostAddress: "1.1.1.1" });
    addContext({ UUID: "RINCON_FRESH", context: "ctx-2", hostAddress: "2.2.2.2" });
    const now = Date.now() / 1000;
    sonosSpeakers["RINCON_DUE"].lastChecked = now - 12;
    sonosSpeakers["RINCON_FRESH"].lastChecked = now - 4;

    const factory = vi.fn(() => makeFakeController());
    const stop = startPollingSupervisor({
      getDeviceCheckIntervalSeconds: () => 10,
      controllerFactory: factory,
      intervalMs: 500,
    });

    await vi.advanceTimersByTimeAsync(600);
    stop();
    // Allow microtasks (Promise.all chain in pollSpeaker) to settle.
    await vi.runAllTimersAsync();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith("1.1.1.1");
  });

  it("AC: speaker currently UPDATING is NOT re-fetched on the next tick", async () => {
    addContext({ UUID: "RINCON_A", context: "ctx-1", hostAddress: "1.1.1.1" });
    sonosSpeakers["RINCON_A"].lastChecked = 0; // overdue
    sonosSpeakers["RINCON_A"].operationalStatus = OPERATIONAL_STATUS.UPDATING;

    const factory = vi.fn(() => makeFakeController());
    const stop = startPollingSupervisor({
      getDeviceCheckIntervalSeconds: () => 10,
      controllerFactory: factory,
      intervalMs: 500,
    });

    await vi.advanceTimersByTimeAsync(2_000); // 4 ticks
    stop();

    expect(factory).not.toHaveBeenCalled();
  });

  it("AC: speaker in RATE_LIMITED is skipped on every tick", async () => {
    addContext({ UUID: "RINCON_A", context: "ctx-1", hostAddress: "1.1.1.1" });
    sonosSpeakers["RINCON_A"].lastChecked = 0;
    sonosSpeakers["RINCON_A"].operationalStatus = OPERATIONAL_STATUS.RATE_LIMITED;

    const factory = vi.fn(() => makeFakeController());
    const stop = startPollingSupervisor({
      getDeviceCheckIntervalSeconds: () => 10,
      controllerFactory: factory,
      intervalMs: 500,
    });

    await vi.advanceTimersByTimeAsync(2_000);
    stop();

    expect(factory).not.toHaveBeenCalled();
  });

  it("AC: stop() cleans up the interval (no further ticks)", async () => {
    addContext({ UUID: "RINCON_A", context: "ctx-1", hostAddress: "1.1.1.1" });
    sonosSpeakers["RINCON_A"].lastChecked = 0;

    const factory = vi.fn(() => makeFakeController());
    const stop = startPollingSupervisor({
      getDeviceCheckIntervalSeconds: () => 10,
      controllerFactory: factory,
      intervalMs: 500,
    });

    await vi.advanceTimersByTimeAsync(600);
    const callsAtStop = factory.mock.calls.length;
    stop();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(factory.mock.calls.length).toBe(callsAtStop);
  });
});
