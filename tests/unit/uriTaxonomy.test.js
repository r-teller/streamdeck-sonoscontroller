import { describe, test, expect } from "vitest";
import { getInputSourceMappings } from "@/modules/common/uriTaxonomy.js";

describe("getInputSourceMappings – classification rules", () => {
  test("TV_Input matches start and end pattern", () => {
    const uri = "x-sonos-htastream12345:spdif";
    const result = getInputSourceMappings(uri);
    expect(result).toEqual({
      currentSource: "TV_Input",
      prefix: "x-sonos-htastream",
      suffix: ":spdif",
    });
  });

  test("Line_In matches start pattern", () => {
    const uri = "x-rincon-streamABCDEF";
    const result = getInputSourceMappings(uri);
    expect(result).toEqual({
      currentSource: "Line_In",
      prefix: "x-rincon-stream",
      suffix: "",
    });
  });

  test("Sonos_Queue is default for various non‑matching inputs", () => {
    const inputs = [
      null,
      undefined,
      "",
      123,
      "x-sonosapi-stream:radio",
      "x-sonos-spotify:track",
      "x-sonos-http:somepath",
      "some-random-uri",
    ];
    for (const uri of inputs) {
      const result = getInputSourceMappings(uri);
      expect(result).toEqual({
        currentSource: "Sonos_Queue",
        prefix: "x-rincon-queue",
        suffix: "#0",
      });
    }
  });

  test("returns a fresh object on each call", () => {
    const first = getInputSourceMappings("x-rincon-streamABC");
    const second = getInputSourceMappings("x-rincon-streamABC");
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  test("result object contains exactly the required keys", () => {
    const result = getInputSourceMappings("x-sonos-htastreamXYZ:spdif");
    const keys = Object.keys(result).sort();
    expect(keys).toEqual(["currentSource", "prefix", "suffix"]);
  });
});
