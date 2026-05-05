import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  sonosSpeakers,
  setOperationalStatus,
  getSpeaker,
  MAX_UPDATES,
  TIME_WINDOW_SECONDS,
} from "@/modules/plugin/SonosSpeakers.js";
import { OPERATIONAL_STATUS } from "@/modules/plugin/operationalStatus.js";

function clearStore() {
  for (const key of Object.keys(sonosSpeakers)) {
    delete sonosSpeakers[key];
  }
}

describe("SonosSpeakers — rate limiter (etr.2 AC)", () => {
  beforeEach(() => {
    clearStore();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-05T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("AC: constants MAX_UPDATES=3 and TIME_WINDOW_SECONDS=10 are exported as named constants", () => {
    expect(MAX_UPDATES).toBe(3);
    expect(TIME_WINDOW_SECONDS).toBe(10);
  });

  it("AC: 3 sequential UPDATING calls inside the window leave operationalStatus === UPDATING", () => {
    setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    expect(getSpeaker({ UUID: "RINCON_A" }).operationalStatus).toBe(
      OPERATIONAL_STATUS.UPDATING,
    );
    expect(sonosSpeakers["RINCON_A"].updateAttempts).toHaveLength(3);
  });

  it("AC: the 4th UPDATING call inside the window flips the speaker to RATE_LIMITED", () => {
    for (let i = 0; i < 4; i++) {
      setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    }
    expect(getSpeaker({ UUID: "RINCON_A" }).operationalStatus).toBe(
      OPERATIONAL_STATUS.RATE_LIMITED,
    );
  });

  it("AC: rate-limit override does NOT touch the speaker.state field", () => {
    sonosSpeakers["RINCON_A"] = {
      ...getSpeaker({ UUID: "RINCON_A" }),
      state: { muted: true, playMode: "NORMAL" },
    };
    for (let i = 0; i < 4; i++) {
      setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    }
    expect(sonosSpeakers["RINCON_A"].state).toEqual({ muted: true, playMode: "NORMAL" });
  });

  it("AC: after 11 seconds with no further attempts, the next UPDATING call resumes (window decay)", () => {
    for (let i = 0; i < 4; i++) {
      setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    }
    expect(sonosSpeakers["RINCON_A"].operationalStatus).toBe(OPERATIONAL_STATUS.RATE_LIMITED);

    vi.advanceTimersByTime(11_000);

    setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    expect(sonosSpeakers["RINCON_A"].operationalStatus).toBe(OPERATIONAL_STATUS.UPDATING);
    // The decayed entries are gone; only the fresh attempt remains.
    expect(sonosSpeakers["RINCON_A"].updateAttempts).toHaveLength(1);
  });

  it("AC: setOperationalStatus(UPDATED) resets updateAttempts to an empty array", () => {
    for (let i = 0; i < 3; i++) {
      setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    }
    expect(sonosSpeakers["RINCON_A"].updateAttempts).toHaveLength(3);

    setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATED });
    expect(sonosSpeakers["RINCON_A"].updateAttempts).toEqual([]);
    expect(sonosSpeakers["RINCON_A"].operationalStatus).toBe(OPERATIONAL_STATUS.UPDATED);
  });

  it("AC: post-UPDATED reset, 3 fresh UPDATING calls succeed before the next trip", () => {
    for (let i = 0; i < 3; i++) {
      setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    }
    setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATED });

    setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    expect(sonosSpeakers["RINCON_A"].operationalStatus).toBe(OPERATIONAL_STATUS.UPDATING);
  });

  it("partial decay: 2 attempts at t=0, then 2 more at t=8 → 4-entry window trips", () => {
    setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    vi.advanceTimersByTime(8_000);
    setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    expect(sonosSpeakers["RINCON_A"].operationalStatus).toBe(OPERATIONAL_STATUS.RATE_LIMITED);
  });

  it("partial decay: 2 attempts at t=0, then 2 more at t=11 → first two decayed, 2-entry window passes", () => {
    setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    vi.advanceTimersByTime(11_000);
    setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    setOperationalStatus({ UUID: "RINCON_A", operationalStatus: OPERATIONAL_STATUS.UPDATING });
    expect(sonosSpeakers["RINCON_A"].operationalStatus).toBe(OPERATIONAL_STATUS.UPDATING);
    // Only the two fresh entries survive the filter.
    expect(sonosSpeakers["RINCON_A"].updateAttempts).toHaveLength(2);
  });
});
