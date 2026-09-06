// @vitest-environment jsdom
import { expect, test, vi, beforeEach, afterEach } from "vitest";
import * as sdConnect from "@/modules/common/sdConnect.js";

class MockWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    MockWebSocket.instances.push(this);
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
    if (this.onclose) this.onclose({ code: 1000, reason: "normal" });
  }
}
let wsInstance;

beforeEach(() => {
  MockWebSocket.instances = [];
  vi.stubGlobal("WebSocket", MockWebSocket);
  // Attach a no‑op catch to any existing pending promise before tearing down
  const pending = sdConnect.streamDeckReady;
  if (pending) pending.catch(() => {});
  // Ensure a fresh ready promise for each test
  sdConnect.teardownStreamDeckBridge();
});

afterEach(() => {
  // Attach a no‑op catch to any pending promise created by the test
  const pending = sdConnect.streamDeckReady;
  if (pending) pending.catch(() => {});
  // Clean globals if a test left them
  sdConnect.teardownStreamDeckBridge();
  vi.restoreAllMocks();
});

test("installStreamDeckBridge is idempotent", () => {
  sdConnect.installStreamDeckBridge();
  const first = window.connectElgatoStreamDeckSocket;
  sdConnect.installStreamDeckBridge();
  expect(window.connectElgatoStreamDeckSocket).toBe(first);
});

test("streamDeckReady resolves on first bridge connection", async () => {
  sdConnect.installStreamDeckBridge();
  const readyPromise = sdConnect.streamDeckReady;
  const client = window.connectElgatoStreamDeckSocket(1234, "uuid-1", "reg", {}, null);
  wsInstance = MockWebSocket.instances[0];
  wsInstance.onopen(); // trigger registration
  const resolved = await readyPromise;
  expect(resolved).toBe(client);
  expect(sdConnect.getStreamDeckClient()).toBe(client);
});

test("getStreamDeckClient is null before install and set after", () => {
  expect(sdConnect.getStreamDeckClient()).toBeNull();
  sdConnect.installStreamDeckBridge();
  window.connectElgatoStreamDeckSocket(1234, "u", "reg", {}, null);
  expect(sdConnect.getStreamDeckClient()).not.toBeNull();
});

test("teardown rejects a pending streamDeckReady promise", async () => {
  sdConnect.installStreamDeckBridge();
  const pending = sdConnect.streamDeckReady;
  const rejectPromise = pending.catch((e) => e);
  sdConnect.teardownStreamDeckBridge();
  const err = await rejectPromise;
  expect(err).toBeInstanceOf(Error);
  expect(err.message).toContain("torn down while still pending");
  // after teardown a new pending promise should exist
  expect(sdConnect.streamDeckReady).not.toBe(pending);
});

test("bridge teardown cleans globals and closes client", async () => {
  sdConnect.installStreamDeckBridge();
  const client = window.connectElgatoStreamDeckSocket(1234, "u", "reg", {}, null);
  wsInstance = MockWebSocket.instances[0];
  wsInstance.onopen();
  expect(window.$SD).toBe(client);
  sdConnect.teardownStreamDeckBridge();
  expect(window.$SD).toBeUndefined();
  expect(window.connectElgatoStreamDeckSocket).toBeUndefined();
  expect(wsInstance.closed).toBe(true);
});
