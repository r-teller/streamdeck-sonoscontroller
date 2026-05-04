// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  getInputSourceMappings,
  INPUT_SOURCE_FACTORIES,
} from "@/modules/common/uriTaxonomy.js";

const COORD = "RINCON_xxxxxxxxxxxx01400";

describe("getInputSourceMappings — classification (h75.5 AC#1–5)", () => {
  it("AC#1: x-sonos-htastream:...:spdif → TV_Input", () => {
    const result = getInputSourceMappings(`x-sonos-htastream:${COORD}:spdif`);
    expect(result.currentSource).toBe("TV_Input");
  });

  it("AC#2: x-rincon-stream:... → Line_In", () => {
    const result = getInputSourceMappings(`x-rincon-stream:${COORD}`);
    expect(result.currentSource).toBe("Line_In");
  });

  it("AC#3: x-rincon-queue:...#0 → Sonos_Queue", () => {
    const result = getInputSourceMappings(`x-rincon-queue:${COORD}#0`);
    expect(result.currentSource).toBe("Sonos_Queue");
  });

  it("AC#4: x-sonosapi-stream:... → Sonos_Queue (radio falls through)", () => {
    const result = getInputSourceMappings("x-sonosapi-stream:s12345?sid=254");
    expect(result.currentSource).toBe("Sonos_Queue");
  });

  it("AC#5a: empty string → Sonos_Queue (safe default)", () => {
    const result = getInputSourceMappings("");
    expect(result.currentSource).toBe("Sonos_Queue");
  });

  it("AC#5b: undefined → Sonos_Queue (safe default)", () => {
    const result = getInputSourceMappings(undefined);
    expect(result.currentSource).toBe("Sonos_Queue");
  });

  it("AC#5c: null → Sonos_Queue (safe default)", () => {
    const result = getInputSourceMappings(null);
    expect(result.currentSource).toBe("Sonos_Queue");
  });
});

describe("getInputSourceMappings — factory output (h75.5 AC#6)", () => {
  it("TV_Input factory joins to x-sonos-htastream:RINCON_xxx:spdif", () => {
    const { prefix, suffix } = getInputSourceMappings(
      `x-sonos-htastream:${COORD}:spdif`,
    );
    expect(`${prefix}:${COORD}${suffix}`).toBe(
      `x-sonos-htastream:${COORD}:spdif`,
    );
  });

  it("Line_In factory joins to x-rincon-stream:RINCON_xxx", () => {
    const { prefix, suffix } = getInputSourceMappings(
      `x-rincon-stream:${COORD}`,
    );
    expect(`${prefix}:${COORD}${suffix}`).toBe(`x-rincon-stream:${COORD}`);
  });

  it("Sonos_Queue factory joins to x-rincon-queue:RINCON_xxx#0", () => {
    const { prefix, suffix } = getInputSourceMappings(
      `x-rincon-queue:${COORD}#0`,
    );
    expect(`${prefix}:${COORD}${suffix}`).toBe(`x-rincon-queue:${COORD}#0`);
  });

  it("INPUT_SOURCE_FACTORIES exposes all three target sources", () => {
    expect(Object.keys(INPUT_SOURCE_FACTORIES).sort()).toEqual([
      "Line_In",
      "Sonos_Queue",
      "TV_Input",
    ]);
    expect(
      `${INPUT_SOURCE_FACTORIES.TV_Input.prefix}:${COORD}${INPUT_SOURCE_FACTORIES.TV_Input.suffix}`,
    ).toBe(`x-sonos-htastream:${COORD}:spdif`);
    expect(
      `${INPUT_SOURCE_FACTORIES.Line_In.prefix}:${COORD}${INPUT_SOURCE_FACTORIES.Line_In.suffix}`,
    ).toBe(`x-rincon-stream:${COORD}`);
    expect(
      `${INPUT_SOURCE_FACTORIES.Sonos_Queue.prefix}:${COORD}${INPUT_SOURCE_FACTORIES.Sonos_Queue.suffix}`,
    ).toBe(`x-rincon-queue:${COORD}#0`);
  });
});

describe("getInputSourceMappings — purity (h75.5 AC#7)", () => {
  it("returns a fresh object on each call (no shared mutation)", () => {
    const a = getInputSourceMappings("x-rincon-queue:foo#0");
    const b = getInputSourceMappings("x-rincon-queue:foo#0");
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("does not mutate the input string or any module state", () => {
    const input = "x-rincon-stream:foo";
    const before = input;
    getInputSourceMappings(input);
    getInputSourceMappings(input);
    expect(input).toBe(before);
  });

  it("INPUT_SOURCE_FACTORIES entries are frozen", () => {
    expect(Object.isFrozen(INPUT_SOURCE_FACTORIES)).toBe(true);
    expect(Object.isFrozen(INPUT_SOURCE_FACTORIES.TV_Input)).toBe(true);
    expect(Object.isFrozen(INPUT_SOURCE_FACTORIES.Line_In)).toBe(true);
    expect(Object.isFrozen(INPUT_SOURCE_FACTORIES.Sonos_Queue)).toBe(true);
  });
});
