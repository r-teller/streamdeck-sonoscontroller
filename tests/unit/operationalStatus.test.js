import { describe, test, expect } from "vitest";
import { OPERATIONAL_STATUS } from "@/modules/plugin/operationalStatus.js";

describe("OPERATIONAL_STATUS enum", () => {
  const expectedKeys = ["UNINITIALIZED", "UPDATING", "UPDATED", "CONNECTED", "CONNECTING", "DISCONNECTED", "RATE_LIMITED"];

  test("has exactly the required keys with matching values", () => {
    const keys = Object.keys(OPERATIONAL_STATUS);
    expect(keys).toEqual(expectedKeys);
    for (const key of expectedKeys) {
      expect(OPERATIONAL_STATUS[key]).toBe(key);
    }
  });

  test("is frozen – assignments throw TypeError", () => {
    expect(() => {
      // @ts-ignore – intentional mutation test
      OPERATIONAL_STATUS.UNINITIALIZED = "foo";
    }).toThrow(TypeError);
  });

  test("is frozen – adding new properties throws TypeError", () => {
    expect(() => {
      // @ts-ignore – intentional mutation test
      OPERATIONAL_STATUS.NEW_STATUS = "NEW_STATUS";
    }).toThrow(TypeError);
  });
});
