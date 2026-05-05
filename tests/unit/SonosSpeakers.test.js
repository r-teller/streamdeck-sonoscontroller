import { describe, it, expect, beforeEach } from "vitest";
import {
  sonosSpeakers,
  getSpeaker,
  addContext,
  removeContext,
  moveContext,
  updateSpeakerState,
  setOperationalStatus,
  getAllSpeakers,
} from "@/modules/plugin/SonosSpeakers.js";
import { OPERATIONAL_STATUS } from "@/modules/plugin/operationalStatus.js";

function clearStore() {
  for (const key of Object.keys(sonosSpeakers)) {
    delete sonosSpeakers[key];
  }
}

describe("SonosSpeakers — singleton + record shape (etr.1 AC)", () => {
  beforeEach(() => clearStore());

  it("AC: getAllSpeakers returns the same reactive map across imports (singleton)", () => {
    expect(getAllSpeakers()).toBe(sonosSpeakers);
  });

  it("AC: getSpeaker on a previously unknown UUID lazy-creates a record with all required fields", () => {
    const speaker = getSpeaker({ UUID: "RINCON_NEW" });
    expect(speaker).toEqual({
      contexts: [],
      operationalStatus: OPERATIONAL_STATUS.UNINITIALIZED,
      state: {},
      updateAttempts: [],
      lastChecked: null,
      lastUpdated: null,
    });
    expect(getAllSpeakers()).toHaveProperty("RINCON_NEW");
  });

  it("getSpeaker is idempotent — repeated calls return the same record reference", () => {
    const a = getSpeaker({ UUID: "RINCON_X" });
    const b = getSpeaker({ UUID: "RINCON_X" });
    expect(a).toBe(b);
  });

  it("getSpeaker does not throw when global settings have not yet been received", () => {
    expect(() => getSpeaker({ UUID: "RINCON_UNSEEN" })).not.toThrow();
  });
});

describe("SonosSpeakers — context bookkeeping (etr.1 AC)", () => {
  beforeEach(() => clearStore());

  it("AC: addContext is idempotent — adding the same context twice leaves contexts.length === 1", () => {
    addContext({ UUID: "RINCON_A", context: "ctx-A" });
    addContext({ UUID: "RINCON_A", context: "ctx-A" });
    expect(sonosSpeakers["RINCON_A"].contexts).toHaveLength(1);
    expect(sonosSpeakers["RINCON_A"].contexts).toContain("ctx-A");
  });

  it("addContext sets hostAddress/zoneName on first registration only", () => {
    addContext({
      UUID: "RINCON_A",
      context: "ctx-1",
      hostAddress: "192.168.1.10",
      zoneName: "Office",
    });
    addContext({
      UUID: "RINCON_A",
      context: "ctx-2",
      hostAddress: "10.0.0.99",
      zoneName: "Different",
    });
    expect(sonosSpeakers["RINCON_A"].hostAddress).toBe("192.168.1.10");
    expect(sonosSpeakers["RINCON_A"].zoneName).toBe("Office");
  });

  it("AC: removeContext on the last bound context removes the speaker entirely", () => {
    addContext({ UUID: "RINCON_A", context: "ctx-A" });
    const wasRemoved = removeContext({ UUID: "RINCON_A", context: "ctx-A" });
    expect(wasRemoved).toBe(true);
    expect(getAllSpeakers()).not.toHaveProperty("RINCON_A");
  });

  it("AC: removeContext on a non-last context leaves the speaker record present", () => {
    addContext({ UUID: "RINCON_A", context: "ctx-A" });
    addContext({ UUID: "RINCON_A", context: "ctx-B" });
    const wasRemoved = removeContext({ UUID: "RINCON_A", context: "ctx-A" });
    expect(wasRemoved).toBe(false);
    expect(getAllSpeakers()).toHaveProperty("RINCON_A");
    expect(sonosSpeakers["RINCON_A"].contexts).toEqual(["ctx-B"]);
  });

  it("removeContext on an unknown UUID is a safe no-op", () => {
    expect(() =>
      removeContext({ UUID: "RINCON_GHOST", context: "ctx-X" }),
    ).not.toThrow();
  });

  it("AC: moveContext atomically removes from one speaker and adds to another", () => {
    addContext({ UUID: "RINCON_A", context: "ctx-X" });
    addContext({ UUID: "RINCON_A", context: "ctx-keepA" });
    moveContext({
      fromUUID: "RINCON_A",
      toUUID: "RINCON_B",
      context: "ctx-X",
      hostAddress: "192.168.1.20",
      zoneName: "Kitchen",
    });
    expect(sonosSpeakers["RINCON_A"].contexts).toEqual(["ctx-keepA"]);
    expect(sonosSpeakers["RINCON_B"].contexts).toContain("ctx-X");
    expect(sonosSpeakers["RINCON_B"].hostAddress).toBe("192.168.1.20");
  });

  it("moveContext cleans up the source speaker if the moved context was its last", () => {
    addContext({ UUID: "RINCON_A", context: "ctx-only" });
    moveContext({ fromUUID: "RINCON_A", toUUID: "RINCON_B", context: "ctx-only" });
    expect(getAllSpeakers()).not.toHaveProperty("RINCON_A");
    expect(sonosSpeakers["RINCON_B"].contexts).toEqual(["ctx-only"]);
  });
});

describe("SonosSpeakers — updateSpeakerState (etr.1 AC)", () => {
  beforeEach(() => clearStore());

  it("AC: updateSpeakerState deep-merges nested audioEqualizer, preserving prior fields", () => {
    updateSpeakerState({
      UUID: "RINCON_A",
      state: { audioEqualizer: { volume: 50 } },
      updateLastChecked: true,
    });
    updateSpeakerState({
      UUID: "RINCON_A",
      state: { audioEqualizer: { bass: 3 } },
    });
    expect(sonosSpeakers["RINCON_A"].state.audioEqualizer).toEqual({
      volume: 50,
      bass: 3,
    });
  });

  it("updateSpeakerState shallow-merges top-level state keys (playMode, muted, etc.)", () => {
    updateSpeakerState({
      UUID: "RINCON_A",
      state: { muted: false, playMode: "NORMAL" },
    });
    updateSpeakerState({
      UUID: "RINCON_A",
      state: { muted: true },
    });
    expect(sonosSpeakers["RINCON_A"].state).toMatchObject({
      muted: true,
      playMode: "NORMAL",
    });
  });

  it("AC: updateLastChecked=true updates BOTH lastChecked and lastUpdated", () => {
    updateSpeakerState({
      UUID: "RINCON_A",
      state: { muted: false },
      updateLastChecked: true,
    });
    const r = sonosSpeakers["RINCON_A"];
    expect(r.lastChecked).not.toBe(null);
    expect(r.lastUpdated).not.toBe(null);
    expect(typeof r.lastChecked).toBe("number");
  });

  it("AC: updateLastChecked=false (default) updates NEITHER lastChecked nor lastUpdated", () => {
    updateSpeakerState({
      UUID: "RINCON_A",
      state: { muted: false },
    });
    const r = sonosSpeakers["RINCON_A"];
    expect(r.lastChecked).toBe(null);
    expect(r.lastUpdated).toBe(null);
  });
});

describe("SonosSpeakers — setOperationalStatus (etr.1 AC)", () => {
  beforeEach(() => clearStore());

  it("AC: setOperationalStatus(UPDATING) pushes a timestamp to updateAttempts", () => {
    setOperationalStatus({
      UUID: "RINCON_A",
      operationalStatus: OPERATIONAL_STATUS.UPDATING,
    });
    expect(sonosSpeakers["RINCON_A"].updateAttempts).toHaveLength(1);
    expect(typeof sonosSpeakers["RINCON_A"].updateAttempts[0]).toBe("number");
  });

  it("AC: setOperationalStatus(UPDATED) does NOT push a timestamp", () => {
    setOperationalStatus({
      UUID: "RINCON_A",
      operationalStatus: OPERATIONAL_STATUS.UPDATED,
    });
    expect(sonosSpeakers["RINCON_A"].updateAttempts).toHaveLength(0);
  });

  it("setOperationalStatus(UPDATING) called 3 times pushes 3 timestamps (rate-limit window data)", () => {
    setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    expect(sonosSpeakers["RINCON_A"].updateAttempts).toHaveLength(3);
  });

  it("AC: setOperationalStatus uses OPERATIONAL_STATUS values, not string literals", () => {
    // Records receive the exact enum reference — guards against drift if the
    // enum's string form ever changes (it shouldn't, but the test pins the contract).
    setOperationalStatus({
      UUID: "RINCON_A",
      operationalStatus: OPERATIONAL_STATUS.DISCONNECTED,
    });
    expect(sonosSpeakers["RINCON_A"].operationalStatus).toBe(
      OPERATIONAL_STATUS.DISCONNECTED,
    );
  });

  it("AC: lazy-init records have operationalStatus === OPERATIONAL_STATUS.UNINITIALIZED (not a literal)", () => {
    const speaker = getSpeaker({ UUID: "RINCON_NEW" });
    expect(speaker.operationalStatus).toBe(OPERATIONAL_STATUS.UNINITIALIZED);
  });
});
