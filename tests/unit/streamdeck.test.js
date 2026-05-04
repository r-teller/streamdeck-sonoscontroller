// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter as NodeEventEmitter } from "node:events";

// @elgato/streamdeck reads manifest.json from cwd at import time. Stub it.
vi.mock("@elgato/streamdeck", () => ({ EventEmitter: NodeEventEmitter }));

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.sent = [];
    MockWebSocket.last = this;
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  triggerOpen() {
    this.onopen?.();
  }
  triggerMessage(obj) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
}

beforeEach(() => {
  globalThis.WebSocket = MockWebSocket;
});

const { StreamDeck } = await import("@/modules/common/streamdeck.js");

describe("StreamDeck — registration handshake", () => {
  it("opens ws://localhost:<port> and sends {event, uuid} on onopen", () => {
    const sd = new StreamDeck(28196, "ctx-uuid-abc", "registerPropertyInspector", "{}", "{}");
    expect(MockWebSocket.last.url).toBe("ws://localhost:28196");
    MockWebSocket.last.triggerOpen();
    expect(MockWebSocket.last.sent[0]).toEqual({
      event: "registerPropertyInspector",
      uuid: "ctx-uuid-abc",
    });
    expect(sd).toBeInstanceOf(StreamDeck);
  });
});

describe("StreamDeck — incoming event re-emission", () => {
  it("renames didReceiveGlobalSettings → globalsettings and forwards payload.settings only", () => {
    const sd = new StreamDeck(1, "u", "registerPlugin", "{}", "{}");
    const handler = vi.fn();
    sd.on("globalsettings", handler);
    MockWebSocket.last.triggerMessage({
      event: "didReceiveGlobalSettings",
      payload: { settings: { theKey: "theValue" } },
    });
    expect(handler).toHaveBeenCalledWith({ theKey: "theValue" });
  });

  it("re-emits keyDown / dialRotate / touchTap with the full incoming object", () => {
    const sd = new StreamDeck(1, "u", "registerPlugin", "{}", "{}");
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
    const sd = new StreamDeck(1, "u", "registerPlugin", "{}", "{}");
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
    sd = new StreamDeck(1, "pi-uuid", "registerPropertyInspector", "{}", "{}");
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

  it("getSettings defaults context to propertyInspectorUUID", () => {
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

  it("setImage payload omits target field (per AC) and includes state", () => {
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

  it("logMessage wraps in payload.message", () => {
    sd.logMessage({ messageText: "hello" });
    expect(lastSent()).toEqual({ event: "logMessage", payload: { message: "hello" } });
  });

  it("sendToPropertyInspector forwards context + payload", () => {
    sd.sendToPropertyInspector({ context: "ctx-2", payload: { tag: "x" } });
    expect(lastSent()).toEqual({ event: "sendToPropertyInspector", context: "ctx-2", payload: { tag: "x" } });
  });

  // REGRESSION: main's bug used propertyInspectorUUID as the action field.
  // The rebuild takes action as a parameter so it gets the action UUID.
  it("sendToPlugin uses the passed-in action UUID, NOT propertyInspectorUUID", () => {
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
