import { EventEmitter } from "@elgato/streamdeck";

export class StreamDeck {
  constructor(inPort, inPropertyInspectorUUID, inRegisterEvent, inInfo, inActionInfo) {
    let actionInfo = JSON.parse(inActionInfo);
    this.propertyInspectorUUID = inPropertyInspectorUUID;
    this.events = new EventEmitter();

    this.streamDeckWebsocket = new WebSocket("ws://localhost:" + inPort);
    this.streamDeckWebsocket.onopen = () => {
      let json = {
        event: inRegisterEvent,
        uuid: inPropertyInspectorUUID,
      };
      this.streamDeckWebsocket.send(JSON.stringify(json));
      this.events.emit("connected", actionInfo);
    };

    this.on = (evt, fn) => this.events.on(evt, fn);

    this.streamDeckWebsocket.onmessage = (evt) => {
      let incomingEvent = JSON.parse(evt.data);
      switch (incomingEvent.event) {
        case "didReceiveGlobalSettings":
          this.events.emit("globalsettings", incomingEvent.payload["settings"]);
          break;
        case "deviceDidConnect":
          this.events.emit("deviceDidConnect", incomingEvent);
          break;
        case "deviceDidDisconnect":
          this.events.emit("deviceDidDisconnect", incomingEvent);
          break;
        case "keyDown":
          this.events.emit("keyDown", incomingEvent);
          break;
        case "keyUp":
          this.events.emit("keyUp", incomingEvent);
          break;
        case "dialDown":
          this.events.emit("dialDown", incomingEvent);
          break;
        case "dialUp":
          this.events.emit("dialUp", incomingEvent);
          break;
        case "dialRotate":
          this.events.emit("dialRotate", incomingEvent);
          break;
        case "touchTap":
          this.events.emit("touchTap", incomingEvent);
          break;
        case "systemDidWakeUp":
          this.events.emit("systemDidWakeUp", incomingEvent);
          break;
        case "willAppear":
          this.events.emit("willAppear", incomingEvent);
          break;
        case "willDisappear":
          this.events.emit("willDisappear", incomingEvent);
          break;
        case "didReceiveSettings":
          this.events.emit("didReceiveSettings", incomingEvent);
          break;
        case "sendToPlugin":
          this.events.emit("sendToPlugin", incomingEvent);
          break;
        case "sendToPropertyInspector":
          this.events.emit("sendToPropertyInspector", incomingEvent);
          break;
        case "propertyInspectorDidAppear":
          this.events.emit("propertyInspectorDidAppear", incomingEvent);
          break;
        case "propertyInspectorDidDisappear":
          this.events.emit("propertyInspectorDidDisappear", incomingEvent);
          break;
        case "titleParametersDidChange":
          this.events.emit("titleParametersDidChange", incomingEvent);
          break;
        default:
          console.log(`Unhandled Event: ${incomingEvent.event}`);
          break;
      }
    };
  }

  requestGlobalSettings() {
    let getGlobalSettingsMessage = {
      event: "getGlobalSettings",
      context: this.propertyInspectorUUID,
    };
    this.streamDeckWebsocket.send(JSON.stringify(getGlobalSettingsMessage));
  }

  saveGlobalSettings({ payload }) {
    let message = {
      event: "setGlobalSettings",
      context: this.propertyInspectorUUID,
      payload: payload,
    };

    this.streamDeckWebsocket.send(JSON.stringify(message));
  }

  getSettings({ context = this.propertyInspectorUUID } = {}) {
    let message = {
      event: "getSettings",
      context: context,
    };
    this.streamDeckWebsocket.send(JSON.stringify(message));
  }

  saveSettings({ actionSettings, context = this.propertyInspectorUUID }) {
    let message = {
      event: "setSettings",
      context: context,
      payload: actionSettings,
    };
    this.streamDeckWebsocket.send(JSON.stringify(message));
  }

  setTitle({ context, title }) {
    let message = {
      event: "setTitle",
      context: context,
      payload: {
        title: title,
        target: 0,
      },
    };
    this.streamDeckWebsocket.send(JSON.stringify(message));
  }

  logMessage({ messageText }) {
    let message = {
      event: "logMessage",
      payload: {
        message: messageText,
      },
    };
    this.streamDeckWebsocket.send(JSON.stringify(message));
  }

  setImage({ context, image, state = 0 }) {
    let message = {
      event: "setImage",
      context: context,
      payload: {
        image: image,
        target: 0,
        state,
      },
    };

    this.streamDeckWebsocket.send(JSON.stringify(message));
  }

  setFeedback({ context, payload }) {
    let message = {
      event: "setFeedback",
      context: context,
      payload: payload,
    };

    this.streamDeckWebsocket.send(JSON.stringify(message));
  }

  setFeedbackLayout({ context, payload }) {
    let message = {
      event: "setFeedbackLayout",
      context: context,
      payload: payload,
    };

    this.streamDeckWebsocket.send(JSON.stringify(message));
  }

  showAlert({ context }) {
    let message = {
      event: "showAlert",
      context: context,
    };

    this.streamDeckWebsocket.send(JSON.stringify(message));
  }

  showOk({ context }) {
    let message = {
      event: "showOk",
      context: context,
    };

    this.streamDeckWebsocket.send(JSON.stringify(message));
  }

  setState({ context, stateIndex }) {
    let message = {
      event: "setState",
      context: context,
      payload: {
        state: stateIndex,
      },
    };

    this.streamDeckWebsocket.send(JSON.stringify(message));
  }

  sendToPlugin({ context, payload }) {    let message = {
      action: this.propertyInspectorUUID,
      event: "sendToPlugin",
      context: context,
      payload,
    };

    this.streamDeckWebsocket.send(JSON.stringify(message));
  }

  sendToPropertyInspector({ context, payload }) {
    let message = {
      event: "sendToPropertyInspector",
      context: context,
      payload,
    };

    this.streamDeckWebsocket.send(JSON.stringify(message));
  }
}
