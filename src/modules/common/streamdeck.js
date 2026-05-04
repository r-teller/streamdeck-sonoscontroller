import { EventEmitter } from "@elgato/streamdeck";

const RE_EMIT = {
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
};

export class StreamDeck extends EventEmitter {
  constructor(inPort, inPropertyInspectorUUID, inRegisterEvent, inInfo, inActionInfo) {
    super();
    const actionInfo = inActionInfo ? JSON.parse(inActionInfo) : null;
    this.propertyInspectorUUID = inPropertyInspectorUUID;
    this.streamDeckWebsocket = new WebSocket(`ws://localhost:${inPort}`);

    this.streamDeckWebsocket.onopen = () => {
      this.streamDeckWebsocket.send(
        JSON.stringify({
          event: inRegisterEvent,
          uuid: inPropertyInspectorUUID,
        }),
      );
      this.emit("connected", actionInfo);
    };

    this.streamDeckWebsocket.onmessage = (evt) => {
      const incoming = JSON.parse(evt.data);
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
    };
  }

  _send(message) {
    this.streamDeckWebsocket.send(JSON.stringify(message));
  }

  requestGlobalSettings() {
    this._send({ event: "getGlobalSettings", context: this.propertyInspectorUUID });
  }

  saveGlobalSettings({ payload }) {
    this._send({ event: "setGlobalSettings", context: this.propertyInspectorUUID, payload });
  }

  getSettings({ context = this.propertyInspectorUUID } = {}) {
    this._send({ event: "getSettings", context });
  }

  saveSettings({ actionSettings, context = this.propertyInspectorUUID }) {
    this._send({ event: "setSettings", context, payload: actionSettings });
  }

  setTitle({ context, title }) {
    this._send({ event: "setTitle", context, payload: { title, target: 0 } });
  }

  logMessage({ messageText }) {
    this._send({ event: "logMessage", payload: { message: messageText } });
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

  sendToPlugin({ action, context, payload }) {
    this._send({ action, event: "sendToPlugin", context, payload });
  }

  sendToPropertyInspector({ context, payload }) {
    this._send({ event: "sendToPropertyInspector", context, payload });
  }
}
