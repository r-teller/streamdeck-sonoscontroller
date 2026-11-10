import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

import {
  getSpeaker,
  addContext,
  removeContext,
  moveContext,
  updateSpeakerState,
  setOperationalStatus,
  getAllSpeakers,
  MAX_UPDATES,
  TIME_WINDOW_SECONDS,
} from "@/modules/plugin/SonosSpeakers.js";

import { OPERATIONAL_STATUS } from "@/modules/plugin/operationalStatus.js";

const UUID = "test-uuid";
const OTHER_UUID = "other-uuid";

beforeEach(() => {
  // reset singleton store
  const all = getAllSpeakers();
  for (const k of Object.keys(all)) {
    delete all[k];
  }
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Speaker lifecycle and storage", () => {
  test("lazy-create is idempotent and returns a correctly shaped record", () => {
    const first = getSpeaker({ UUID });
    const second = getSpeaker({ UUID });
    expect(first).toBe(second);
    expect(first).toMatchObject({
      contexts: [],
      operationalStatus: OPERATIONAL_STATUS.UNINITIALIZED,
      state: {},
      updateAttempts: [],
      lastChecked: null,
      lastUpdated: null,
    });
  });

  test("first-write-wins for hostAddress and zoneName", () => {
    addContext({
      UUID,
      context: "ctx1",
      hostAddress: "192.168.1.10",
      zoneName: "Living Room",
    });
    // second call tries to overwrite with different values
    addContext({
      UUID,
      context: "ctx2",
      hostAddress: "10.0.0.5",
      zoneName: "Kitchen",
    });
    const speaker = getSpeaker({ UUID });
    expect(speaker.hostAddress).toBe("192.168.1.10");
    expect(speaker.zoneName).toBe("Living Room");
  });

  test("undefined hostAddress/zoneName never overwrite existing values", () => {
    addContext({
      UUID,
      context: "ctx1",
      hostAddress: "192.168.1.10",
      zoneName: "Living Room",
    });
    addContext({
      UUID,
      context: "ctx2",
      hostAddress: undefined,
      zoneName: undefined,
    });
    const speaker = getSpeaker({ UUID });
    expect(speaker.hostAddress).toBe("192.168.1.10");
    expect(speaker.zoneName).toBe("Living Room");
  });

  test("context deduplication and accumulation", () => {
    addContext({ UUID, context: "ctxA" });
    addContext({ UUID, context: "ctxA" }); // duplicate
    addContext({ UUID, context: "ctxB" });
    const speaker = getSpeaker({ UUID });
    expect(speaker.contexts).toEqual(["ctxA", "ctxB"]);
  });

  test("removing the last context deletes the speaker record", () => {
    addContext({ UUID, context: "onlyCtx" });
    const removed = removeContext({ UUID, context: "onlyCtx" });
    expect(removed).toBe(true);
    expect(getAllSpeakers()[UUID]).toBeUndefined();
  });

  test("removeContext on unknown UUID returns false", () => {
    const result = removeContext({ UUID: "nonexistent", context: "any" });
    expect(result).toBe(false);
  });

  test("moveContext transfers a context and respects first-write-wins host/zone", () => {
    addContext({ UUID, context: "ctx1", hostAddress: "1.1.1.1", zoneName: "A" });
    const moved = moveContext({
      fromUUID: UUID,
      toUUID: OTHER_UUID,
      context: "ctx1",
      hostAddress: "2.2.2.2",
      zoneName: "B",
    });
    expect(moved).toBe(true);
    expect(getAllSpeakers()[UUID]).toBeUndefined();
    const target = getSpeaker({ UUID: OTHER_UUID });
    expect(target.contexts).toContain("ctx1");
    expect(target.hostAddress).toBe("2.2.2.2");
    expect(target.zoneName).toBe("B");
  });

  test("moveContext binds the destination even when the source lacks the context (sonos-ba8)", () => {
    const moved = moveContext({
      fromUUID: UUID,
      toUUID: OTHER_UUID,
      context: "orphanCtx",
      hostAddress: "3.3.3.3",
      zoneName: "C",
    });
    expect(moved).toBe(false);
    expect(getAllSpeakers()[UUID]).toBeUndefined();
    const target = getAllSpeakers()[OTHER_UUID];
    expect(target.contexts).toContain("orphanCtx");
    expect(target.hostAddress).toBe("3.3.3.3");
  });
});

describe("Speaker state updates", () => {
  test("audioEqualizer merges deeply while other keys replace shallowly", () => {
    // initial state
    updateSpeakerState({
      UUID,
      state: {
        audioEqualizer: { volume: 10, bass: 5 },
        playing: { trackId: 1, paused: false },
      },
    });

    // second update
    updateSpeakerState({
      UUID,
      state: {
        audioEqualizer: { bass: 7 }, // merge
        playing: { trackId: 2, paused: true }, // replace
      },
    });

    const speaker = getSpeaker({ UUID });
    expect(speaker.state.audioEqualizer).toEqual({ volume: 10, bass: 7 });
    expect(speaker.state.playing).toEqual({ trackId: 2, paused: true });
  });

  test("updateLastChecked defaults to false (no timestamps)", () => {
    updateSpeakerState({ UUID, state: { foo: "bar" } });
    const speaker = getSpeaker({ UUID });
    expect(speaker.lastChecked).toBeNull();
    expect(speaker.lastUpdated).toBeNull();
  });

  test("updateLastChecked true stamps epoch seconds", async () => {
    const nowMs = 1_600_000_000_000; // arbitrary epoch ms
    vi.setSystemTime(nowMs);
    updateSpeakerState({
      UUID,
      state: { foo: "bar" },
      updateLastChecked: true,
    });
    const speaker = getSpeaker({ UUID });
    const expectedSec = nowMs / 1000;
    expect(speaker.lastChecked).toBeCloseTo(expectedSec);
    expect(speaker.lastUpdated).toBeCloseTo(expectedSec);
  });
});

describe("Operational status & rate limiting", () => {
  test("UPDATING within window respects MAX_UPDATES without RATE_LIMITED", () => {
    for (let i = 0; i < MAX_UPDATES; i++) {
      setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATING });
      const speaker = getSpeaker({ UUID });
      expect(speaker.operationalStatus).toBe(OPERATIONAL_STATUS.UPDATING);
    }
  });

  test("4th UPDATING within window triggers RATE_LIMITED", () => {
    for (let i = 0; i < MAX_UPDATES; i++) {
      setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATING });
    }
    // 4th attempt
    setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATING });
    const speaker = getSpeaker({ UUID });
    expect(speaker.operationalStatus).toBe(OPERATIONAL_STATUS.RATE_LIMITED);
  });

  test("UPDATED clears updateAttempts allowing fresh UPDATING bursts", () => {
    // fill attempts to rate limit
    for (let i = 0; i < MAX_UPDATES + 1; i++) {
      setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATING });
    }
    // clear
    setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATED });
    const speaker = getSpeaker({ UUID });
    expect(speaker.updateAttempts).toEqual([]);
    expect(speaker.operationalStatus).toBe(OPERATIONAL_STATUS.UPDATED);

    // new burst
    for (let i = 0; i < MAX_UPDATES; i++) {
      setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATING });
      expect(getSpeaker({ UUID }).operationalStatus).toBe(OPERATIONAL_STATUS.UPDATING);
    }
  });

  test("attempts decay after TIME_WINDOW_SECONDS", async () => {
    // three attempts at t=0
    vi.setSystemTime(0);
    for (let i = 0; i < MAX_UPDATES; i++) {
      setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATING });
    }
    // advance beyond window
    await vi.advanceTimersByTimeAsync((TIME_WINDOW_SECONDS + 1) * 1000);
    // now a new attempt should be allowed
    setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATING });
    expect(getSpeaker({ UUID }).operationalStatus).toBe(OPERATIONAL_STATUS.UPDATING);
  });

  test("partial-window decay keeps correct count", async () => {
    // attempts at t=0,1,2 seconds
    vi.setSystemTime(0);
    setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATING });
    vi.setSystemTime(1000);
    setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATING });
    vi.setSystemTime(2000);
    setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATING });

    // advance to t=10.5 seconds (10500 ms)
    await vi.advanceTimersByTimeAsync(8500);
    // now the first attempt (t=0) should have decayed (>10s old)
    setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATING });
    const speaker = getSpeaker({ UUID });
    expect(speaker.updateAttempts.length).toBe(3); // two old + new one
    expect(speaker.operationalStatus).toBe(OPERATIONAL_STATUS.UPDATING);
  });

  test("inclusive boundary: attempt exactly at window limit counts", () => {
    // first at t=0
    vi.setSystemTime(0);
    setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATING });

    // second at t=TIME_WINDOW_SECONDS * 1000
    vi.setSystemTime(TIME_WINDOW_SECONDS * 1000);
    setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATING });

    const speaker = getSpeaker({ UUID });
    expect(speaker.updateAttempts.length).toBe(2);
    expect(speaker.operationalStatus).toBe(OPERATIONAL_STATUS.UPDATING);
  });

  test("non‑UPDATING statuses are assigned directly", () => {
    setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.DISCONNECTED });
    const speaker = getSpeaker({ UUID });
    expect(speaker.operationalStatus).toBe(OPERATIONAL_STATUS.DISCONNECTED);
  });
});
