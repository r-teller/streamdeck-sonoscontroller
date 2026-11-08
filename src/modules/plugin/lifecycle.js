import { callAction as defaultCallAction } from "./actionDispatcher.js";
import { handleDialRotate as defaultHandleDialRotate } from "./dialRotateDebouncer.js";
import {
  clearDedupeCache as defaultClearDedupeCache,
  refreshStateAndTitle as defaultRefreshStateAndTitle,
} from "./renderDedupe.js";
import { actionSettings, setActionSettings, getActionSettings, deleteActionSettings } from "./actionSettings.js";
import { setGlobalSettings } from "./globalSettings.js";
import { addContext, removeContext, moveContext, setSpeakerHost } from "./SonosSpeakers.js";
import { reconcileBindings, summarizeBindings } from "./bindingReconciler.js";
import { cleanupDialRotate, _resetDialRotateState } from "./dialRotateDebouncer.js";

/**
 * Wire lifecycle handlers for Stream Deck events.
 * Returns a teardown function to remove all handlers.
 * PRD §11.5 — normative.
 */
export function wireLifecycleHandlers({ sd }, deps = {}) {
  if (!sd) {
    return () => {};
  }

  const {
    callAction = defaultCallAction,
    handleDialRotate = defaultHandleDialRotate,
    clearDedupeCache = defaultClearDedupeCache,
    refreshStateAndTitle = defaultRefreshStateAndTitle,
  } = deps;

  const dispatchDeps = {
    actionSettings,
    showAlert: ({ context }) => sd.showAlert({ context }),
    refreshStateAndTitle,
  };

  // Named handlers for teardown
  const handlers = {};

  // The PI currently open (if any), so binding summaries can be pushed to it.
  let propertyInspector = null;

  const pushBindings = () => {
    if (!propertyInspector) return;
    sd.sendToPropertyInspector?.({
      action: propertyInspector.action,
      context: propertyInspector.context,
      payload: { type: "bindings", bindings: summarizeBindings() },
    });
  };

  handlers.willAppear = (msg) => {
    const { action, context, payload } = msg;
    setActionSettings(context, {
      action,
      controller: payload.controller ?? "Keypad",
      currentStateIndex: payload.state ?? 0,
      ...payload.settings,
      status: {},
    });
    const s = payload.settings ?? {};
    if (s.uuid) {
      addContext({ UUID: s.uuid, context, hostAddress: s.hostAddress, zoneName: s.zoneName });
      reconcileBindings({ sd, contexts: [context], clearDedupeCache });
    }
  };

  handlers.willDisappear = (msg) => {
    const prev = getActionSettings(msg.context);
    if (prev?.uuid) {
      removeContext({ UUID: prev.uuid, context: msg.context });
    }
    cleanupDialRotate(msg.context);
    deleteActionSettings(msg.context);
  };

  handlers.didReceiveSettings = (msg) => {
    const prev = getActionSettings(msg.context) ?? {};
    const incoming = msg.payload?.settings ?? {};
    const merged = { ...prev, ...incoming, status: prev.status ?? {} };
    setActionSettings(msg.context, merged);

    if (prev.uuid && incoming.uuid && prev.uuid !== incoming.uuid) {
      moveContext({
        fromUUID: prev.uuid,
        toUUID: incoming.uuid,
        context: msg.context,
        hostAddress: incoming.hostAddress,
        zoneName: incoming.zoneName,
      });
      clearDedupeCache(msg.context);
    } else if (prev.uuid && incoming.uuid === prev.uuid && incoming.hostAddress) {
      // Same speaker, possibly a new IP: polling must follow it (sonos-l07).
      setSpeakerHost({ UUID: incoming.uuid, hostAddress: incoming.hostAddress });
    } else if (!prev.uuid && incoming.uuid) {
      addContext({
        UUID: incoming.uuid,
        context: msg.context,
        hostAddress: incoming.hostAddress,
        zoneName: incoming.zoneName,
      });
    }
  };

  handlers.globalsettings = (settingsBlob) => {
    setGlobalSettings(settingsBlob);
    reconcileBindings({ sd, clearDedupeCache });
    pushBindings();
  };

  handlers.propertyInspectorDidAppear = (msg) => {
    propertyInspector = { action: msg.action, context: msg.context };
    pushBindings();
  };

  handlers.propertyInspectorDidDisappear = (msg) => {
    if (propertyInspector?.context === msg.context) propertyInspector = null;
  };

  handlers.sendToPlugin = (msg) => {
    if (msg.payload?.type === "getBindings") {
      propertyInspector = { action: msg.action, context: msg.context };
      pushBindings();
    }
  };

  // deliberate no-op: lastChecked staleness makes polling re-converge naturally
  handlers.systemDidWakeUp = () => {};

  handlers.keyDown = (msg) => {
    callAction({ inContext: msg.context, inEvent: "keyDown" }, dispatchDeps);
  };

  handlers.dialDown = (msg) => {
    callAction({ inContext: msg.context, inEvent: "dialDown" }, dispatchDeps);
  };

  handlers.touchTap = (msg) => {
    callAction({ inContext: msg.context, inEvent: "touchTap" }, dispatchDeps);
  };

  handlers.dialRotate = (msg) => {
    handleDialRotate({
      context: msg.context,
      ticks: msg.payload?.ticks ?? 0,
      dispatch: (args) => callAction(args, dispatchDeps),
    });
  };

  // Wire handlers
  const events = Object.keys(handlers);
  events.forEach((event) => {
    sd.on(event, handlers[event]);
  });

  // Teardown: idempotent
  return () => {
    events.forEach((event) => {
      sd.off(event, handlers[event]);
    });
    _resetDialRotateState();
  };
}

// Deliberately NOT subscribed: keyUp, dialUp (no long-press semantics)
