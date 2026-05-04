// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { SonosError, translateSonosError } from "@/modules/common/sonosErrors.js";

const ctx = { op: "get devices", host: "192.168.1.42", port: 1400, timeoutSec: 10 };

describe("translateSonosError — SonosError categories (AC#1–4)", () => {
  it("timeout → 'Failed to <op>: Timeout while reaching <host>:<port> after <N> seconds'", () => {
    const transportErr = new SonosError("raw", "timeout", { host: "192.168.1.42", port: 1400, timeoutMs: 10000 });
    const translated = translateSonosError(transportErr, ctx);
    expect(translated.message).toBe("Failed to get devices: Timeout while reaching 192.168.1.42:1400 after 10 seconds");
  });

  it("network → 'Failed to <op>: Could not reach <host>:<port>'", () => {
    const transportErr = new SonosError("raw", "network", { host: "192.168.1.42", port: 1400, cause: "ECONNREFUSED" });
    const translated = translateSonosError(transportErr, ctx);
    expect(translated.message).toBe("Failed to get devices: Could not reach 192.168.1.42:1400");
  });

  it("fault → 'Failed to <op>: Sonos returned error <code>: <description>'", () => {
    const transportErr = new SonosError("raw", "fault", { faultCode: "401", faultDescription: "Invalid Action" });
    const translated = translateSonosError(transportErr, { ...ctx, op: "play" });
    expect(translated.message).toBe("Failed to play: Sonos returned error 401: Invalid Action");
  });

  it("http → 'Failed to <op>: Sonos returned HTTP <status>'", () => {
    const transportErr = new SonosError("raw", "http", { status: 503 });
    const translated = translateSonosError(transportErr, { ...ctx, op: "set volume" });
    expect(translated.message).toBe("Failed to set volume: Sonos returned HTTP 503");
  });

  it("parse → 'Failed to <op>: Could not parse response from <host>:<port>'", () => {
    const transportErr = new SonosError("raw", "parse", { host: "192.168.1.42", port: 1400 });
    const translated = translateSonosError(transportErr, ctx);
    expect(translated.message).toBe("Failed to get devices: Could not parse response from 192.168.1.42:1400");
  });

  it("unknown SonosError category falls through to underlying message", () => {
    const transportErr = new SonosError("something weird", "unknown");
    const translated = translateSonosError(transportErr, ctx);
    expect(translated.message).toBe("Failed to get devices: something weird");
  });

  it("preserves the original error as .cause for diagnostics", () => {
    const transportErr = new SonosError("raw", "network", { host: "x", port: 1 });
    const translated = translateSonosError(transportErr, ctx);
    expect(translated.cause).toBe(transportErr);
  });
});

describe("translateSonosError — PR #3 safety net (AC#5)", () => {
  it("translates TypeError 'is not iterable' into 'Unexpected response shape'", () => {
    const err = new TypeError("ZoneGroup is not iterable");
    const translated = translateSonosError(err, ctx);
    expect(translated.message).toBe("Failed to get devices: Unexpected response shape from 192.168.1.42:1400");
  });

  it("translates TypeError 'Cannot read properties of undefined' into 'Unexpected response shape'", () => {
    const err = new TypeError("Cannot read properties of undefined (reading 'ZoneGroup')");
    const translated = translateSonosError(err, ctx);
    expect(translated.message).toBe("Failed to get devices: Unexpected response shape from 192.168.1.42:1400");
  });

  it("preserves the TypeError as .cause for diagnostics", () => {
    const err = new TypeError("ZoneGroup is not iterable");
    const translated = translateSonosError(err, ctx);
    expect(translated.cause).toBe(err);
  });
});

describe("translateSonosError — generic Error fallthrough", () => {
  it("plain Error gets the op prefix without category-specific phrasing", () => {
    const err = new Error("kaboom");
    const translated = translateSonosError(err, ctx);
    expect(translated.message).toBe("Failed to get devices: kaboom");
  });

  it("nullish or unset error message degrades to 'unexpected error'", () => {
    const translated = translateSonosError(new Error(""), ctx);
    expect(translated.message).toBe("Failed to get devices: unexpected error");
  });

  it("undefined error degrades to 'unexpected error'", () => {
    const translated = translateSonosError(undefined, ctx);
    expect(translated.message).toBe("Failed to get devices: unexpected error");
  });
});

describe("translateSonosError — never leaks programmer artifacts (AC#6 spirit)", () => {
  // Parameterized: every category + the regression class produces a clean
  // message free of TypeError / fetch failed / is not iterable / Cannot read.
  it.each([
    [new SonosError("raw", "timeout", { host: "h", port: 1, timeoutMs: 1000 }), "play"],
    [new SonosError("raw", "network", { host: "h", port: 1 }), "set volume"],
    [new SonosError("raw", "fault", { faultCode: "401", faultDescription: "X" }), "next"],
    [new SonosError("raw", "http", { status: 500 }), "previous"],
    [new SonosError("raw", "parse", { host: "h", port: 1 }), "get favorites"],
    [new TypeError("ZoneGroup is not iterable"), "get devices"],
    [new TypeError("Cannot read properties of undefined"), "get devices"],
  ])("never includes 'TypeError' / 'fetch failed' / 'is not iterable' in the translated message", (err, op) => {
    const translated = translateSonosError(err, { op, host: "192.168.1.42", port: 1400, timeoutSec: 10 });
    expect(translated.message).not.toMatch(/TypeError/);
    expect(translated.message).not.toMatch(/fetch failed/);
    expect(translated.message).not.toMatch(/is not iterable/);
    expect(translated.message).not.toMatch(/Cannot read prop/);
  });
});
