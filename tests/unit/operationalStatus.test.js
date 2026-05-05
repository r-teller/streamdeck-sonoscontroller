import { describe, it, expect } from "vitest";
import { OPERATIONAL_STATUS } from "@/modules/plugin/operationalStatus.js";

describe("OPERATIONAL_STATUS — shape (etr.9 AC)", () => {
  it("exports all seven members verbatim", () => {
    expect(Object.keys(OPERATIONAL_STATUS).sort()).toEqual([
      "CONNECTED",
      "CONNECTING",
      "DISCONNECTED",
      "RATE_LIMITED",
      "UNINITIALIZED",
      "UPDATED",
      "UPDATING",
    ]);
  });

  it("each member's value equals its key (string-identical)", () => {
    for (const key of Object.keys(OPERATIONAL_STATUS)) {
      expect(OPERATIONAL_STATUS[key]).toBe(key);
    }
  });

  it("OPERATIONAL_STATUS.UPDATING === 'UPDATING' (regression guard)", () => {
    expect(OPERATIONAL_STATUS.UPDATING).toBe("UPDATING");
    expect(OPERATIONAL_STATUS.RATE_LIMITED).toBe("RATE_LIMITED");
  });
});

describe("OPERATIONAL_STATUS — frozen", () => {
  it("the exported object is frozen", () => {
    expect(Object.isFrozen(OPERATIONAL_STATUS)).toBe(true);
  });

  it("mutation attempts throw in strict mode", () => {
    "use strict";
    expect(() => {
      OPERATIONAL_STATUS.NEW_MEMBER = "NEW_MEMBER";
    }).toThrow(TypeError);
    expect(() => {
      OPERATIONAL_STATUS.UPDATING = "MUTATED";
    }).toThrow(TypeError);
  });
});
