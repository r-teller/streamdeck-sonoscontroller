// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter as NodeEventEmitter } from "node:events";

// @elgato/streamdeck reads manifest.json from cwd at import time. Stub it.
vi.mock("@elgato/streamdeck", () => ({ EventEmitter: NodeEventEmitter }));

class MockWebSocket {
  static CLOSED = 3;
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.listeners = { open: [], message: [], close: [], error: [] };
    MockWebSocket.last = this;
  }
  addEventListener(type, fn) {
    this.listeners[type].push(fn);
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
  triggerOpen() {
    this.listeners.open.forEach((fn) => fn());
  }
  triggerMessage(obj) {
    const data = typeof obj === "string" ? obj : JSON.stringify(obj);
    this.listeners.message.forEach((fn) => fn({ data }));
  }
  triggerClose(code = 1000, reason = "normal") {
    this.listeners.close.forEach((fn) => fn({ code, reason }));
  }
  triggerError(err) {
    this.listeners.error.forEach((fn) => fn(err));
  }
}

beforeEach(() => {
  globalThis.WebSocket = MockWebSocket;
});

const { StreamDeck } = await import("@/modules/common/streamdeck.js");

const newClient = (overrides = {}) =>
  new StreamDeck({
    port: 28196,
    uuid: "ctx-uuid-abc",
    registerEvent: "registerPropertyInspector",
    actionInfo: JSON.stringify({ action: "com.example.action" }),
    ...overrides,
  });

describe("StreamDeck — registration handshake", () => {
  it("opens ws://localhost:<port> and sends {event, uuid} on socket open", () => {
    const sd = newClient();
    expect(MockWebSocket.last.url).toBe("ws://localhost:28196");
    MockWebSocket.last.triggerOpen();
    expect(MockWebSocket.last.sent[0]).toEqual({
      event: "registerPropertyInspector",
      uuid: "ctx-uuid-abc",
    });
    expect(sd).toBeInstanceOf(StreamDeck);
  });

  it("parses actionInfo and exposes it as a property for late subscribers", () => {
    const sd = newClient();
    expect(sd.actionInfo).toEqual({ action: "com.example.action" });
  });

  it("handles missing actionInfo (plugin side) without throwing", () => {
    const sd = new StreamDeck({ port: 1, uuid: "u", registerEvent: "registerPlugin" });
    expect(sd.actionInfo).toBe(null);
  });

  it("emits 'connected' with parsed actionInfo on socket open", () => {
    const sd = newClient();
    const handler = vi.fn();
    sd.on("connected", handler);
    MockWebSocket.last.triggerOpen();
    expect(handler).toHaveBeenCalledWith({ action: "com.example.action" });
  });

  it("flips connected flag after socket open", () => {
    const sd = newClient();
    expect(sd.connected).toBe(false);
    MockWebSocket.last.triggerOpen();
    expect(sd.connected).toBe(true);
  });
});

describe("StreamDeck — close / error / malformed handling", () => {
  it("emits 'disconnected' with {code, reason} on socket close", () => {
    const sd = newClient();
    const handler = vi.fn();
    sd.on("disconnected", handler);
    MockWebSocket.last.triggerOpen();
    MockWebSocket.last.triggerClose(1006, "abnormal closure");
    expect(handler).toHaveBeenCalledWith({ code: 1006, reason: "abnormal closure" });
    expect(sd.connected).toBe(false);
  });

  it("emits 'error' on socket error event", () => {
    const sd = newClient();
    const handler = vi.fn();
    sd.on("error", handler);
    const errEvt = { message: "boom" };
    MockWebSocket.last.triggerError(errEvt);
    expect(handler).toHaveBeenCalledWith(errEvt);
  });

  it("drops malformed (non-JSON) incoming messages with a warn, no throw", () => {
    const sd = newClient();
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => MockWebSocket.last.triggerMessage("{not json")).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(sd).toBeDefined();
  });

  it("drops messages without an event field", () => {
    const sd = newClient();
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => MockWebSocket.last.triggerMessage({ payload: { foo: 1 } })).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect(sd).toBeDefined();
  });
});

describe("StreamDeck — incoming event re-emission", () => {
  it("renames didReceiveGlobalSettings → globalsettings and forwards payload.settings only", () => {
    const sd = newClient();
    const handler = vi.fn();
    sd.on("globalsettings", handler);
    MockWebSocket.last.triggerMessage({
      event: "didReceiveGlobalSettings",
      payload: { settings: { theKey: "theValue" } },
    });
    expect(handler).toHaveBeenCalledWith({ theKey: "theValue" });
  });

  it("re-emits keyDown / dialRotate / touchTap / willAppear / systemDidWakeUp", () => {
    const sd = newClient();
    const events = ["keyDown", "dialRotate", "touchTap", "willAppear", "systemDidWakeUp"];
    for (const evt of events) {
      const handler = vi.fn();
      sd.on(evt, handler);
      const incoming = { event: evt, context: "ctx", payload: { tag: evt } };
      MockWebSocket.last.triggerMessage(incoming);
      expect(handler).toHaveBeenCalledWith(incoming);
    }
  });

  it("logs and drops unknown events without throwing", () => {
    const sd = newClient();
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    MockWebSocket.last.triggerMessage({ event: "totallyMadeUpEvent" });
    expect(spy).toHaveBeenCalledWith("Unhandled Event: totallyMadeUpEvent");
    spy.mockRestore();
    expect(sd).toBeDefined();
  });
});

describe("StreamDeck — outgoing helpers", () => {
  let sd;
  beforeEach(() => {
    sd = newClient({ uuid: "pi-uuid" });
    MockWebSocket.last.triggerOpen();
    MockWebSocket.last.sent.length = 0;
  });

  const lastSent = () => MockWebSocket.last.sent[MockWebSocket.last.sent.length - 1];

  it("requestGlobalSettings → getGlobalSettings + context", () => {
    sd.requestGlobalSettings();
    expect(lastSent()).toEqual({ event: "getGlobalSettings", context: "pi-uuid" });
  });

  it("saveGlobalSettings → setGlobalSettings + payload", () => {
    sd.saveGlobalSettings({ payload: { foo: "bar" } });
    expect(lastSent()).toEqual({ event: "setGlobalSettings", context: "pi-uuid", payload: { foo: "bar" } });
  });

  it("getSettings defaults context to the client's uuid", () => {
    sd.getSettings();
    expect(lastSent()).toEqual({ event: "getSettings", context: "pi-uuid" });
  });

  it("saveSettings forwards actionSettings as payload", () => {
    sd.saveSettings({ actionSettings: { uuid: "spk" }, context: "ctx-1" });
    expect(lastSent()).toEqual({ event: "setSettings", context: "ctx-1", payload: { uuid: "spk" } });
  });

  it("setTitle hard-codes target: 0 (both states)", () => {
    sd.setTitle({ context: "ctx-1", title: "OFFICE" });
    expect(lastSent()).toEqual({ event: "setTitle", context: "ctx-1", payload: { title: "OFFICE", target: 0 } });
  });

  it("setImage payload omits target and includes state", () => {
    sd.setImage({ context: "ctx", image: "data:image/png;base64,xxx", state: 1 });
    const sent = lastSent();
    expect(sent.event).toBe("setImage");
    expect(sent.context).toBe("ctx");
    expect(sent.payload).toEqual({ image: "data:image/png;base64,xxx", state: 1 });
    expect("target" in sent.payload).toBe(false);
  });

  it("setState payload uses {state: stateIndex}", () => {
    sd.setState({ context: "ctx", stateIndex: 2 });
    expect(lastSent()).toEqual({ event: "setState", context: "ctx", payload: { state: 2 } });
  });

  it("setFeedback / setFeedbackLayout pass payload through", () => {
    sd.setFeedback({ context: "ctx", payload: { value: 50 } });
    expect(lastSent()).toEqual({ event: "setFeedback", context: "ctx", payload: { value: 50 } });
    sd.setFeedbackLayout({ context: "ctx", payload: { layout: "x.json" } });
    expect(lastSent()).toEqual({ event: "setFeedbackLayout", context: "ctx", payload: { layout: "x.json" } });
  });

  it("showAlert / showOk send context only", () => {
    sd.showAlert({ context: "ctx" });
    expect(lastSent()).toEqual({ event: "showAlert", context: "ctx" });
    sd.showOk({ context: "ctx" });
    expect(lastSent()).toEqual({ event: "showOk", context: "ctx" });
  });

  it("logMessage takes a positional string and wraps in payload.message", () => {
    sd.logMessage("hello");
    expect(lastSent()).toEqual({ event: "logMessage", payload: { message: "hello" } });
  });

  it("sendToPropertyInspector forwards context + payload", () => {
    sd.sendToPropertyInspector({ context: "ctx-2", payload: { tag: "x" } });
    expect(lastSent()).toEqual({ event: "sendToPropertyInspector", context: "ctx-2", payload: { tag: "x" } });
  });

  // REGRESSION: main's bug used propertyInspectorUUID as the action field.
  it("sendToPlugin uses the passed-in action UUID, NOT the client's uuid", () => {
    sd.sendToPlugin({
      action: "com.r-teller.sonoscontroller.toggle-mute-unmute",
      context: "ctx-3",
      payload: { request: "refresh" },
    });
    expect(lastSent()).toEqual({
      action: "com.r-teller.sonoscontroller.toggle-mute-unmute",
      event: "sendToPlugin",
      context: "ctx-3",
      payload: { request: "refresh" },
    });
    expect(lastSent().action).not.toBe("pi-uuid");
  });
});

describe("StreamDeck — close()", () => {
  it("close() is idempotent on an already-closed socket", () => {
    const sd = newClient();
    sd.close();
    expect(MockWebSocket.last.readyState).toBe(MockWebSocket.CLOSED);
    expect(() => sd.close()).not.toThrow();
  });
});
