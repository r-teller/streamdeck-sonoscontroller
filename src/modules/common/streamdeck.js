import { EventEmitter } from "@elgato/streamdeck";

// Map Stream Deck SDK incoming event names → EventEmitter event names emitted
// by this client. Most names pass through unchanged; the one rename is
// `didReceiveGlobalSettings` → `globalsettings`, which downstream consumers
// (PiComponent, plugin runtime) subscribe to.
const RE_EMIT = Object.freeze({
  didReceiveGlobalSettings: "globalsettings",
  deviceDidConnect: "deviceDidConnect",
  deviceDidDisconnect: "deviceDidDisconnect",
  keyDown: "keyDown",
  keyUp: "keyUp",
  dialDown: "dialDown",
  dialUp: "dialUp",
  dialRotate: "dialRotate",
  touchTap: "touchTap",
  systemDidWakeUp: "systemDidWakeUp",
  willAppear: "willAppear",
  willDisappear: "willDisappear",
  didReceiveSettings: "didReceiveSettings",
  sendToPlugin: "sendToPlugin",
  sendToPropertyInspector: "sendToPropertyInspector",
  propertyInspectorDidAppear: "propertyInspectorDidAppear",
  propertyInspectorDidDisappear: "propertyInspectorDidDisappear",
  titleParametersDidChange: "titleParametersDidChange",
});

/**
 * Hand-rolled Stream Deck WebSocket client. Extends EventEmitter so consumers
 * can subscribe with `client.on(name, handler)`.
 *
 * Lifecycle events (in addition to the SDK pass-throughs above):
 *   - `connected`    fires after registration handshake completes; payload is
 *                    the parsed actionInfo (or null on the plugin side).
 *   - `disconnected` fires on socket close; payload `{code, reason}`.
 *   - `error`        fires on socket error; payload is the underlying event.
 *
 * Late subscribers: `actionInfo` is cached as a property so consumers that
 * subscribe after `connected` fired can still read it via `client.actionInfo`.
 */
export class StreamDeck extends EventEmitter {
  /**
   * @param {object} opts
   * @param {number} opts.port — WebSocket port supplied by the Stream Deck app.
   * @param {string} opts.uuid — Property Inspector or plugin UUID; this is the
   *   default `context` for outgoing messages whose SDK schema requires one
   *   but where this client owns the value (e.g., `getGlobalSettings`).
   * @param {string} opts.registerEvent — `registerPlugin` or
   *   `registerPropertyInspector`.
   * @param {string} [opts.actionInfo] — JSON-encoded action info. Only the PI
   *   receives this; plugin side gets it as the empty string.
   *
   * `info` (the host-application-info payload) is intentionally accepted but
   * not stored; the rebuild has no consumer that needs it. Add a property if
   * a future consumer requires it.
   */
  constructor({ port, uuid, registerEvent, actionInfo = null } = {}) {
    super();
    this.uuid = uuid;
    this.actionInfo = actionInfo ? safeJsonParse(actionInfo) : null;
    this.connected = false;
    this.streamDeckWebsocket = new WebSocket(`ws://localhost:${port}`);

    this.streamDeckWebsocket.addEventListener("open", () => {
      this._send({ event: registerEvent, uuid });
      this.connected = true;
      this.emit("connected", this.actionInfo);
    });

    this.streamDeckWebsocket.addEventListener("message", (evt) => {
      const incoming = safeJsonParse(evt.data);
      if (!incoming || typeof incoming.event !== "string") {
        console.warn("StreamDeck: dropped malformed incoming message", evt.data);
        return;
      }
      const reEmitName = RE_EMIT[incoming.event];
      if (!reEmitName) {
        console.log(`Unhandled Event: ${incoming.event}`);
        return;
      }
      if (incoming.event === "didReceiveGlobalSettings") {
        this.emit(reEmitName, incoming.payload?.settings);
      } else {
        this.emit(reEmitName, incoming);
      }
    });

    this.streamDeckWebsocket.addEventListener("close", (evt) => {
      this.connected = false;
      this.emit("disconnected", { code: evt.code, reason: evt.reason });
    });

    this.streamDeckWebsocket.addEventListener("error", (evt) => {
      this.emit("error", evt);
    });
  }

  /** Send a JSON-encoded message over the socket. */
  _send(message) {
    this.streamDeckWebsocket.send(JSON.stringify(message));
  }

  /** Close the socket. Idempotent; safe to call on an already-closed socket. */
  close() {
    if (this.streamDeckWebsocket.readyState !== WebSocket.CLOSED) {
      this.streamDeckWebsocket.close();
    }
  }

  // ── Outgoing helpers ─────────────────────────────────────────────────────

  requestGlobalSettings() {
    this._send({ event: "getGlobalSettings", context: this.uuid });
  }

  saveGlobalSettings({ payload }) {
    this._send({ event: "setGlobalSettings", context: this.uuid, payload });
  }

  getSettings({ context = this.uuid } = {}) {
    this._send({ event: "getSettings", context });
  }

  saveSettings({ actionSettings, context = this.uuid }) {
    this._send({ event: "setSettings", context, payload: actionSettings });
  }

  setTitle({ context, title }) {
    this._send({ event: "setTitle", context, payload: { title, target: 0 } });
  }

  logMessage(message) {
    this._send({ event: "logMessage", payload: { message } });
  }

  setImage({ context, image, state = 0 }) {
    this._send({ event: "setImage", context, payload: { image, state } });
  }

  setFeedback({ context, payload }) {
    this._send({ event: "setFeedback", context, payload });
  }

  setFeedbackLayout({ context, payload }) {
    this._send({ event: "setFeedbackLayout", context, payload });
  }

  showAlert({ context }) {
    this._send({ event: "showAlert", context });
  }

  showOk({ context }) {
    this._send({ event: "showOk", context });
  }

  setState({ context, stateIndex }) {
    this._send({ event: "setState", context, payload: { state: stateIndex } });
  }

  /**
   * `action` MUST be the action UUID (e.g., `com.r-teller.sonoscontroller.toggle-mute-unmute`).
   * Main's prior implementation used `propertyInspectorUUID` here, which the
   * plugin then routed to the wrong action handler.
   */
  sendToPlugin({ action, context, payload }) {
    this._send({ action, event: "sendToPlugin", context, payload });
  }

  sendToPropertyInspector({ context, payload }) {
    this._send({ event: "sendToPropertyInspector", context, payload });
  }
}

function safeJsonParse(input) {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}
