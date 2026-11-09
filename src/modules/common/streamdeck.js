import { EventEmitter } from "@elgato/streamdeck";

class StreamDeck extends EventEmitter {
  constructor({ port, uuid, registerEvent, actionInfo = null }) {
    super();
    this.uuid = uuid;
    this.connected = false;
    this.actionInfo = actionInfo ? JSON.parse(actionInfo) : null;
    this._ws = new WebSocket(`ws://localhost:${port}`);
    this._registerEvent = registerEvent;

    this._ws.onopen = () => {
      this._ws.send(JSON.stringify({ event: registerEvent, uuid }));
      this.connected = true;
      this.emit("connected", this.actionInfo);
    };

    this._ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        console.warn("Malformed WebSocket message dropped", e);
        return;
      }

      const { event: evType } = msg;
      if (evType === "didReceiveGlobalSettings") {
        this.emit("globalsettings", msg.payload.settings);
      } else if (
        [
          "keyDown",
          "keyUp",
          "dialDown",
          "dialUp",
          "dialRotate",
          "touchTap",
          "systemDidWakeUp",
          "willAppear",
          "willDisappear",
          "didReceiveSettings",
          "sendToPlugin",
          "sendToPropertyInspector",
          "propertyInspectorDidAppear",
          "propertyInspectorDidDisappear",
          "titleParametersDidChange",
          "deviceDidConnect",
          "deviceDidDisconnect",
        ].includes(evType)
      ) {
        this.emit(evType, msg);
      } else {
        console.warn(`Unknown event "${evType}" dropped`);
      }
    };

    this._ws.onclose = (event) => {
      this.connected = false;
      this.emit("disconnected", { code: event.code, reason: event.reason });
    };

    this._ws.onerror = (event) => {
      this.emit("error", event);
    };
  }

  requestGlobalSettings() {
    this._send({ event: "getGlobalSettings", context: this.uuid });
  }

  saveGlobalSettings({ payload }) {
    this._send({ event: "setGlobalSettings", context: this.uuid, payload });
  }

  getSettings({ context }) {
    this._send({ event: "getSettings", context });
  }

  saveSettings({ actionSettings, context }) {
    this._send({ event: "setSettings", context, payload: actionSettings });
  }

  setTitle({ context, title }) {
    this._send({ event: "setTitle", context, payload: { title, target: 0 } });
  }

  // Without a state, Stream Deck applies the image to every state of a multi-state action; defaulting
  // to state 0 left e.g. the play/pause key's "Playing" state on its default icon (sonos-1vd).
  setImage({ context, image, state }) {
    const payload = state === undefined ? { image } : { image, state };
    this._send({ event: "setImage", context, payload });
  }

  setFeedback({ context, payload }) {
    this._send({ event: "setFeedback", context, payload });
  }

  setFeedbackLayout({ context, payload }) {
    this._send({ event: "setFeedbackLayout", context, payload });
  }

  setState({ context, stateIndex }) {
    this._send({ event: "setState", context, payload: { state: stateIndex } });
  }

  showAlert({ context }) {
    this._send({ event: "showAlert", context });
  }

  showOk({ context }) {
    this._send({ event: "showOk", context });
  }

  logMessage(message) {
    this._send({ event: "logMessage", payload: { message } });
  }

  sendToPlugin({ action, context, payload }) {
    this._send({ action, event: "sendToPlugin", context, payload });
  }

  sendToPropertyInspector({ action, context, payload }) {
    this._send({ action, event: "sendToPropertyInspector", context, payload });
  }

  openUrl({ url }) {
    this._send({ event: "openUrl", payload: { url } });
  }

  close() {
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
  }

  _send(obj) {
    if (this._ws && this.connected) {
      this._ws.send(JSON.stringify(obj));
    }
  }
}

export { StreamDeck };
