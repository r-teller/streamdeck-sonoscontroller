import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { startPollingSupervisor } from "@/modules/plugin/pollingSupervisor.js";
import { addContext, getSpeaker, getAllSpeakers, setOperationalStatus } from "@/modules/plugin/SonosSpeakers.js";
import { OPERATIONAL_STATUS } from "@/modules/plugin/operationalStatus.js";

vi.useFakeTimers();

describe("pollingSupervisor", () => {
  let stopSupervisor;
  let controllerFactory;
  let showAlert;
  let refreshStateAndTitle;

  const fakeController = (overrides = {}) => ({
    getTransportSettings: vi.fn().mockResolvedValue({ playMode: "NORMAL" }),
    getTransportInfo: vi.fn().mockResolvedValue({ playbackState: "PLAYING" }),
    getMute: vi.fn().mockResolvedValue(false),
    getVolume: vi.fn().mockResolvedValue(42),
    getBass: vi.fn().mockResolvedValue(3),
    getTreble: vi.fn().mockResolvedValue(-2),
    getPositionInfo: vi.fn().mockResolvedValue({
      trackURI: "x-sonos:abc",
      title: "T",
      artist: "A",
      album: "L",
      albumArtURI: "art.jpg",
    }),
    ...overrides,
  });

  const start = () => {
    stopSupervisor = startPollingSupervisor({
      intervalMs: 500,
      getDeviceCheckIntervalSeconds: () => 10,
      getDeviceTimeoutDurationSeconds: () => 5,
      controllerFactory,
      showAlert,
      refreshStateAndTitle,
    });
  };

  beforeEach(() => {
    // reset speaker store
    const all = getAllSpeakers();
    for (const k of Object.keys(all)) delete all[k];

    // fresh spies
    controllerFactory = vi.fn();
    showAlert = vi.fn();
    refreshStateAndTitle = vi.fn();

    // ensure timers are fake
    vi.useFakeTimers();
  });

  afterEach(async () => {
    if (stopSupervisor) stopSupervisor();
    vi.useRealTimers();
  });

  test("staleness gate: stale (12s) speaker is fetched, fresh (4s) is skipped", async () => {
    const UUID = "uuid-1";
    addContext({ UUID, context: "ctx1", hostAddress: "host1" });
    const speaker = getSpeaker({ UUID });
    // make it 12 seconds stale
    speaker.lastChecked = Date.now() / 1000 - 12;

    const freshUUID = "uuid-2";
    addContext({ UUID: freshUUID, context: "ctx2", hostAddress: "host2" });
    const freshSpeaker = getSpeaker({ UUID: freshUUID });
    freshSpeaker.lastChecked = Date.now() / 1000 - 4; // not stale

    controllerFactory.mockImplementation(() => fakeController());

    start();

    await vi.advanceTimersByTimeAsync(500); // first tick

    expect(controllerFactory).toHaveBeenCalledTimes(1);
    expect(controllerFactory).toHaveBeenCalledWith("host1", "uuid-1");
    expect(controllerFactory).not.toHaveBeenCalledWith("host2");
  });

  test("UPDATING / RATE_LIMITED status skips polling", async () => {
    const UUID = "uuid-1";
    addContext({ UUID, context: "ctx1", hostAddress: "host1" });
    const speaker = getSpeaker({ UUID });
    speaker.lastChecked = null; // stale

    // set status to UPDATING
    setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATING });

    controllerFactory.mockImplementation(() => fakeController());

    start();

    await vi.advanceTimersByTimeAsync(500);
    expect(controllerFactory).not.toHaveBeenCalled();

    // now set to RATE_LIMITED
    setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.RATE_LIMITED });

    await vi.advanceTimersByTimeAsync(500);
    expect(controllerFactory).not.toHaveBeenCalled();
  });

  test("successful poll maps speaker state correctly and calls refresh per context", async () => {
    const UUID = "uuid-1";
    addContext({ UUID, context: "ctx1", hostAddress: "host1" });
    addContext({ UUID, context: "ctx2", hostAddress: "host1" });
    const speaker = getSpeaker({ UUID });
    speaker.lastChecked = null;

    controllerFactory.mockImplementation(() => fakeController());

    start();

    await vi.advanceTimersByTimeAsync(500);

    // verify state
    const updatedSpeaker = getSpeaker({ UUID });
    expect(updatedSpeaker.state).toEqual({
      playMode: "NORMAL",
      playbackState: "PLAYING",
      muted: false,
      audioEqualizer: { volume: 42, bass: 3, treble: -2 },
      currentURI: "x-sonos:abc",
      playing: {
        title: "T",
        artist: "A",
        album: "L",
        albumArtURI: "art.jpg",
      },
    });
    expect(updatedSpeaker.lastChecked).toBeGreaterThan(0);
    expect(updatedSpeaker.lastUpdated).toBeGreaterThan(0);
    expect(updatedSpeaker.operationalStatus).toBe(OPERATIONAL_STATUS.UPDATED);

    // refresh called once per bound context
    expect(refreshStateAndTitle).toHaveBeenCalledTimes(2);
    expect(refreshStateAndTitle).toHaveBeenCalledWith({
      inContext: "ctx1",
      inSonosSpeakerState: updatedSpeaker.state,
    });
    expect(refreshStateAndTitle).toHaveBeenCalledWith({
      inContext: "ctx2",
      inSonosSpeakerState: updatedSpeaker.state,
    });
  });

  test("failure when a getter rejects sets DISCONNECTED and alerts per context", async () => {
    const UUID = "uuid-1";
    addContext({ UUID, context: "ctx1", hostAddress: "host1" });
    const speaker = getSpeaker({ UUID });
    speaker.lastChecked = null;

    const badController = fakeController({
      getVolume: vi.fn().mockRejectedValue(new Error("boom")),
    });
    controllerFactory.mockImplementation(() => badController);

    start();

    await vi.advanceTimersByTimeAsync(500);

    const updatedSpeaker = getSpeaker({ UUID });
    expect(updatedSpeaker.operationalStatus).toBe(OPERATIONAL_STATUS.DISCONNECTED);
    expect(updatedSpeaker.lastChecked).toBeNull(); // untouched

    expect(showAlert).toHaveBeenCalledTimes(1);
    expect(showAlert).toHaveBeenCalledWith({ context: "ctx1" });
  });

  test("timeout when getters never resolve leads to DISCONNECTED and alerts", async () => {
    const UUID = "uuid-1";
    addContext({ UUID, context: "ctx1", hostAddress: "host1" });
    const speaker = getSpeaker({ UUID });
    speaker.lastChecked = null;

    const hangingController = {
      getTransportSettings: vi.fn().mockImplementation(() => new Promise(() => {})),
      getTransportInfo: vi.fn().mockImplementation(() => new Promise(() => {})),
      getMute: vi.fn().mockImplementation(() => new Promise(() => {})),
      getVolume: vi.fn().mockImplementation(() => new Promise(() => {})),
      getBass: vi.fn().mockImplementation(() => new Promise(() => {})),
      getTreble: vi.fn().mockImplementation(() => new Promise(() => {})),
      getPositionInfo: vi.fn().mockImplementation(() => new Promise(() => {})),
    };
    controllerFactory.mockImplementation(() => hangingController);

    start();

    // advance past timeout (5s) plus interval
    await vi.advanceTimersByTimeAsync(500); // tick starts request
    await vi.advanceTimersByTimeAsync(5000); // timeout triggers

    const updatedSpeaker = getSpeaker({ UUID });
    expect(updatedSpeaker.operationalStatus).toBe(OPERATIONAL_STATUS.DISCONNECTED);
    expect(showAlert).toHaveBeenCalledTimes(1);
    expect(showAlert).toHaveBeenCalledWith({ context: "ctx1" });
  });

  test("stop() halts further polling and is idempotent", async () => {
    const UUID = "uuid-1";
    addContext({ UUID, context: "ctx1", hostAddress: "host1" });
    const speaker = getSpeaker({ UUID });
    speaker.lastChecked = null;

    controllerFactory.mockImplementation(() => fakeController());

    start();

    await vi.advanceTimersByTimeAsync(500);
    expect(controllerFactory).toHaveBeenCalledTimes(1);

    // stop supervisor
    stopSupervisor();

    // advance many intervals, should not call factory again
    await vi.advanceTimersByTimeAsync(5000);
    expect(controllerFactory).toHaveBeenCalledTimes(1);

    // calling stop again should not error
    expect(() => stopSupervisor()).not.toThrow();
  });

  test("RATE_LIMITED re-check after UPDATING attempts bails before network call", async () => {
    const UUID = "uuid-1";
    addContext({ UUID, context: "ctx1", hostAddress: "host1" });
    const speaker = getSpeaker({ UUID });
    speaker.lastChecked = null;

    // simulate three recent UPDATING attempts
    setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATING });
    setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATING });
    setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATING });

    // now set back to UPDATED (attempts stay)
    getSpeaker({ UUID }).operationalStatus = OPERATIONAL_STATUS.UPDATED;

    // controllerFactory should not be called because next attempt becomes RATE_LIMITED
    controllerFactory.mockImplementation(() => fakeController());

    start();

    await vi.advanceTimersByTimeAsync(500);

    // pollSpeaker will set status to UPDATING (4th attempt) which should flip to RATE_LIMITED internally
    // Hence controllerFactory never invoked
    expect(controllerFactory).not.toHaveBeenCalled();
  });
});
