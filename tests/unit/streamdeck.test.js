// @vitest-environment jsdom
import { expect, test, vi, beforeEach, afterEach } from "vitest";
import { StreamDeck } from "@/modules/common/streamdeck.js";

class MockWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.sent = [];
    this.readyState = 1;
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
  wsInstance = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("registration frame is first sent on open and connected event emitted", async () => {
  const client = new StreamDeck({
    port: 1234,
    uuid: "my-uuid",
    registerEvent: "registerEvent",
    actionInfo: '{"foo":"bar"}',
  });
  wsInstance = MockWebSocket.instances[0];
  const connectedHandler = vi.fn();
  client.on("connected", connectedHandler);
  wsInstance.onopen();
  expect(wsInstance.sent[0]).toEqual({
    event: "registerEvent",
    uuid: "my-uuid",
  });
  expect(client.connected).toBe(true);
  expect(connectedHandler).toHaveBeenCalledOnce();
  expect(connectedHandler).toHaveBeenCalledWith({ foo: "bar" });
});

test("didReceiveGlobalSettings re‑emits as globalsettings with payload.settings", async () => {
  const client = new StreamDeck({
    port: 1234,
    uuid: "u",
    registerEvent: "reg",
  });
  wsInstance = MockWebSocket.instances[0];
  const gsHandler = vi.fn();
  client.on("globalsettings", gsHandler);
  wsInstance.onopen();
  wsInstance.onmessage({
    data: JSON.stringify({
      event: "didReceiveGlobalSettings",
      payload: { settings: { a: 1 } },
    }),
  });
  expect(gsHandler).toHaveBeenCalledOnce();
  expect(gsHandler).toHaveBeenCalledWith({ a: 1 });
});

test("unknown events are dropped with a warning", () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const client = new StreamDeck({
    port: 1234,
    uuid: "u",
    registerEvent: "reg",
  });
  wsInstance = MockWebSocket.instances[0];
  const unknownHandler = vi.fn();
  client.on("someUnknown", unknownHandler);
  wsInstance.onopen();
  wsInstance.onmessage({ data: JSON.stringify({ event: "fooBar", payload: {} }) });
  expect(warnSpy).toHaveBeenCalledOnce();
  expect(warnSpy).toHaveBeenCalledWith('Unknown event "fooBar" dropped');
  expect(unknownHandler).not.toHaveBeenCalled();
  warnSpy.mockRestore();
});

test("malformed JSON messages are warned and dropped", () => {
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const client = new StreamDeck({
    port: 1234,
    uuid: "u",
    registerEvent: "reg",
  });
  wsInstance = MockWebSocket.instances[0];
  wsInstance.onopen();
  wsInstance.onmessage({ data: "not a json" });
  expect(warnSpy).toHaveBeenCalledOnce();
  expect(warnSpy.mock.calls[0][0]).toContain("Malformed WebSocket message dropped");
  warnSpy.mockRestore();
});

test("outgoing helper methods send correct frames after connection", () => {
  const client = new StreamDeck({
    port: 1234,
    uuid: "my-uuid",
    registerEvent: "reg",
  });
  wsInstance = MockWebSocket.instances[0];
  wsInstance.onopen(); // registers and sets connected
  // clear registration frame for easier comparison
  wsInstance.sent = [];

  client.requestGlobalSettings();
  client.saveGlobalSettings({ payload: { foo: "bar" } });
  client.getSettings({ context: "ctx1" });
  client.saveSettings({ actionSettings: { x: 1 }, context: "ctx2" });
  client.setTitle({ context: "c3", title: "Title" });
  client.setImage({ context: "c4", image: "data:", state: 2 });
  client.setImage({ context: "c4b", image: "data:" });
  client.setFeedback({ context: "c5", payload: { f: true } });
  client.setFeedbackLayout({ context: "c6", payload: { layout: "b" } });
  client.setState({ context: "c7", stateIndex: 3 });
  client.showAlert({ context: "c8" });
  client.showOk({ context: "c9" });
  client.logMessage("hello");
  client.sendToPlugin({ action: "com.example.action", context: "c10", payload: { p: 5 } });
  client.sendToPropertyInspector({ context: "c11", payload: { pi: 1 } });

  const expected = [
    { event: "getGlobalSettings", context: "my-uuid" },
    { event: "setGlobalSettings", context: "my-uuid", payload: { foo: "bar" } },
    { event: "getSettings", context: "ctx1" },
    { event: "setSettings", context: "ctx2", payload: { x: 1 } },
    { event: "setTitle", context: "c3", payload: { title: "Title", target: 0 } },
    { event: "setImage", context: "c4", payload: { image: "data:", state: 2 } },
    // no state given: applies to all states (no default to state 0)
    { event: "setImage", context: "c4b", payload: { image: "data:" } },
    { event: "setFeedback", context: "c5", payload: { f: true } },
    { event: "setFeedbackLayout", context: "c6", payload: { layout: "b" } },
    { event: "setState", context: "c7", payload: { state: 3 } },
    { event: "showAlert", context: "c8" },
    { event: "showOk", context: "c9" },
    { event: "logMessage", payload: { message: "hello" } },
    { action: "com.example.action", event: "sendToPlugin", context: "c10", payload: { p: 5 } },
    { event: "sendToPropertyInspector", context: "c11", payload: { pi: 1 } },
  ];
  expect(wsInstance.sent).toEqual(expected);
});

test("close is idempotent", () => {
  const client = new StreamDeck({
    port: 1234,
    uuid: "u",
    registerEvent: "reg",
  });
  wsInstance = MockWebSocket.instances[0];
  wsInstance.onopen();
  client.close();
  expect(wsInstance.closed).toBe(true);
  // second close should not throw
  expect(() => client.close()).not.toThrow();
});
