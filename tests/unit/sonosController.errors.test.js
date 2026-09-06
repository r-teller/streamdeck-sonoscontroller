// @vitest-environment jsdom
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { SonosController } from "@/modules/common/sonosController.js";
import { SonosError } from "@/modules/common/sonosErrors.js";

let originalFetch;

beforeEach(() => {
  // Preserve the real fetch implementation
  originalFetch = globalThis.fetch;
  // Ensure each test starts with a fresh controller instance
  // (any module‑level singleton state is cleared by creating a new instance)
});

afterEach(() => {
  // Restore the original fetch
  globalThis.fetch = originalFetch;
});

describe("SonosController.getDevices() error handling", () => {
  test("translates a network fetch rejection into a boundary Error", async () => {
    // Stub fetch to reject with a TypeError (simulating a network failure)
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    const controller = new SonosController().connect("192.168.1.50");

    let caughtError;
    try {
      await controller.getDevices();
    } catch (err) {
      caughtError = err;
    }

    // Ensure an error was thrown
    expect(caughtError).toBeInstanceOf(Error);
    // It must NOT be a SonosError instance
    expect(caughtError).not.toBeInstanceOf(SonosError);
    // Name should be the default "Error"
    expect(caughtError.name).toBe("Error");
    // Full translated message
    expect(caughtError.message).toBe("Failed to get devices: Could not reach 192.168.1.50:1400");
    // The original SonosError should be attached as the cause
    expect(caughtError.cause).toBeInstanceOf(SonosError);
  });

  test("translates an HTTP 500 response into a boundary Error", async () => {
    // Stub fetch to resolve with a non‑ok response (status 500)
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      // text() returns a promise; body is irrelevant for this case
      text: async () => "",
    });

    const controller = new SonosController().connect("192.168.1.50");

    let caughtError;
    try {
      await controller.getDevices();
    } catch (err) {
      caughtError = err;
    }

    // Ensure an error was thrown
    expect(caughtError).toBeInstanceOf(Error);
    // It must NOT be a SonosError instance
    expect(caughtError).not.toBeInstanceOf(SonosError);
    // Name should be the default "Error"
    expect(caughtError.name).toBe("Error");
    // Full translated message for HTTP 500
    expect(caughtError.message).toBe("Failed to get devices: Sonos returned HTTP 500");
    // The original SonosError should be attached as the cause
    expect(caughtError.cause).toBeInstanceOf(SonosError);
  });
});
