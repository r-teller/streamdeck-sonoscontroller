import { describe, test, expect } from "vitest";
import { SonosError, translateSonosError } from "@/modules/common/sonosErrors.js";

const HOST = "myhost";
const PORT = 1234;
const OP = "do something";

describe("translateSonosError – SonosError categories", () => {
  test("timeout with timeoutMs", () => {
    const err = new SonosError("boom", "timeout", { timeoutMs: 4500 });
    const translated = translateSonosError(err, { op: OP, host: HOST, port: PORT });
    expect(translated).toBeInstanceOf(Error);
    expect(translated).not.toBeInstanceOf(SonosError);
    expect(translated.cause).toBe(err);
    expect(translated.message).toBe(
      `Failed to ${OP}: Timeout while reaching ${HOST}:${PORT} after 4.5 seconds`
    );
  });

  test("timeout with fallback timeoutSec", () => {
    const err = new SonosError("boom", "timeout", {});
    const translated = translateSonosError(err, {
      op: OP,
      host: HOST,
      port: PORT,
      timeoutSec: 7,
    });
    expect(translated.message).toBe(
      `Failed to ${OP}: Timeout while reaching ${HOST}:${PORT} after 7 seconds`
    );
  });

  test("timeout with no timing info → ?", () => {
    const err = new SonosError("boom", "timeout", {});
    const translated = translateSonosError(err, { op: OP, host: HOST, port: PORT });
    expect(translated.message).toBe(
      `Failed to ${OP}: Timeout while reaching ${HOST}:${PORT} after ? seconds`
    );
  });

  test("network", () => {
    const err = new SonosError("boom", "network", {});
    const translated = translateSonosError(err, { op: OP, host: HOST, port: PORT });
    expect(translated.message).toBe(
      `Failed to ${OP}: Could not reach ${HOST}:${PORT}`
    );
  });

  test("fault", () => {
    const err = new SonosError("boom", "fault", {
      faultCode: 123,
      faultDescription: "Bad thing",
    });
    const translated = translateSonosError(err, { op: OP, host: HOST, port: PORT });
    expect(translated.message).toBe(
      `Failed to ${OP}: Sonos returned error 123: Bad thing`
    );
  });

  test("http", () => {
    const err = new SonosError("boom", "http", { status: 502 });
    const translated = translateSonosError(err, { op: OP, host: HOST, port: PORT });
    expect(translated.message).toBe(
      `Failed to ${OP}: Sonos returned HTTP 502`
    );
  });

  test("parse", () => {
    const err = new SonosError("boom", "parse", {});
    const translated = translateSonosError(err, { op: OP, host: HOST, port: PORT });
    expect(translated.message).toBe(
      `Failed to ${OP}: Could not parse response from ${HOST}:${PORT}`
    );
  });

  test("unknown category falls back to safe detail", () => {
    const err = new SonosError("custom message", "unknown", {});
    const translated = translateSonosError(err, { op: OP, host: HOST, port: PORT });
    expect(translated.message).toBe(`Failed to ${OP}: custom message`);
  });
});

describe("translateSonosError – non‑SonosError handling", () => {
  test("TypeError matching safety‑net regex", () => {
    const err = new TypeError("x is not iterable");
    const translated = translateSonosError(err, { op: OP, host: HOST, port: PORT });
    expect(translated.message).toBe(
      `Failed to ${OP}: Unexpected response shape from ${HOST}:${PORT}`
    );
    expect(translated.cause).toBe(err);
  });

  test("generic Error with forbidden substring is sanitized", () => {
    const err = new Error("fetch failed while contacting");
    const translated = translateSonosError(err, { op: OP, host: HOST, port: PORT });
    expect(translated.message).toBe(
      `Failed to ${OP}: Unexpected response shape from ${HOST}:${PORT}`
    );
  });

  test("generic Error without message uses fallback", () => {
    const err = new Error();
    const translated = translateSonosError(err, { op: OP, host: HOST, port: PORT });
    expect(translated.message).toBe(
      `Failed to ${OP}: unexpected error`
    );
  });

  test("no forbidden substrings appear in any translated message", () => {
    const forbidden = ["TypeError", "fetch failed", "is not iterable", "Cannot read prop"];
    const cases = [
      new SonosError("boom", "network", {}),
      new TypeError("Cannot read property 'x' of undefined"),
      new Error("fetch failed"),
      new Error("all good"),
    ];
    for (const err of cases) {
      const translated = translateSonosError(err, { op: OP, host: HOST, port: PORT });
      const lower = translated.message.toLowerCase();
      for (const term of forbidden) {
        expect(lower.includes(term.toLowerCase())).toBe(false);
      }
    }
  });
});
