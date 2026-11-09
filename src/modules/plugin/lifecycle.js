import { callAction as defaultCallAction } from "./actionDispatcher.js";
import { handleDialRotate as defaultHandleDialRotate } from "./dialRotateDebouncer.js";
import {
  clearDedupeCache as defaultClearDedupeCache,
  refreshStateAndTitle as defaultRefreshStateAndTitle,
} from "./renderDedupe.js";
import { actionSettings, setActionSettings, getActionSettings, deleteActionSettings } from "./actionSettings.js";
import { setGlobalSettings, globalSettings } from "./globalSettings.js";
import { addContext, removeContext, moveContext, setSpeakerHost, getAllSpeakers } from "./SonosSpeakers.js";
import { reconcileBindings, summarizeBindings } from "./bindingReconciler.js";
import { isFavoriteSettings, syncFavoriteKeys, persistable } from "./favoriteKeys.js";
import { migrateFavoriteSettings, needsFavoriteMigration, signaturesEqual } from "../common/favoriteSettings.js";
import { resolveSpeaker } from "../common/speakerResolver.js";
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
    afterAction: ({ UUID, inContext }) => {
      if (!isFavoriteSettings(actionSettings[inContext])) return;
      syncFavoriteKeys({ UUID, sd });
      // (callAction already schedules an immediate re-poll so the new track/art arrive right away.)
    },
  };

  /**
   * Draw a key from what is already known about its speaker. Without this a key that appears on an
   * already-polled speaker (page switch, folder, second key) or whose settings changed in the PI
   * kept the manifest default until the next poll, up to a full check interval (sonos-ajj).
   * A speaker with no state yet is polled on the next tick instead.
   */
  function renderNow(context) {
    const uuid = getActionSettings(context)?.uuid;
    const speaker = uuid ? getAllSpeakers()[uuid] : undefined;
    if (!speaker) return;
    if (speaker.state && Object.keys(speaker.state).length > 0) {
      refreshStateAndTitle({ inContext: context, inSonosSpeakerState: speaker.state, force: true });
    } else {
      speaker.lastChecked = 0;
    }
  }

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
    let incoming = payload.settings ?? {};
    // One-time move of legacy favorite toggles onto the new ones (sonos-gw5, agreed Q5).
    if (isFavoriteSettings({ action }) && needsFavoriteMigration(incoming)) {
      incoming = migrateFavoriteSettings(incoming);
      sd.saveSettings?.({ actionSettings: incoming, context });
    }
    setActionSettings(context, {
      action,
      controller: payload.controller ?? "Keypad",
      currentStateIndex: payload.state ?? 0,
      ...incoming,
      status: {},
    });
    const s = incoming;
    if (s.uuid) {
      addContext({ UUID: s.uuid, context, hostAddress: s.hostAddress, zoneName: s.zoneName });
      reconcileBindings({ sd, contexts: [context], clearDedupeCache });
      const bound = getActionSettings(context);
      if (isFavoriteSettings(bound)) syncFavoriteKeys({ UUID: bound.uuid, sd });
      renderNow(context);
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

  /**
   * The PI writes its whole settings snapshot. If the plugin changed a plugin-owned field since the
   * PI last heard (binding repointed by reconcileBindings, favorite signature by syncFavoriteKeys),
   * a PI toggle in that window would write the stale value back (sonos-uyz). Keep the plugin's value.
   * @returns {{ settings: Object, corrected: boolean }}
   */
  function guardPluginOwnedFields(prev, incoming) {
    const out = { ...incoming };
    let corrected = false;
    if (prev.uuid && out.uuid && out.uuid !== prev.uuid) {
      const r = resolveSpeaker({ uuid: out.uuid, hostAddress: out.hostAddress, zoneName: out.zoneName }, globalSettings);
      // The PI only offers live devices, so an old uuid that *resolves* to the current binding is stale.
      if (r.source !== "device" && r.source !== "saved" && r.uuid === prev.uuid) {
        out.uuid = prev.uuid;
        out.hostAddress = prev.hostAddress;
        out.zoneName = prev.zoneName;
        if (prev.title !== undefined) out.title = prev.title;
        corrected = true;
      }
    }
    if (isFavoriteSettings(prev)) {
      const prevUri = prev.selectedSonosFavorite?.uri;
      const nextUri = out.selectedSonosFavorite?.uri ?? prevUri;
      if (nextUri !== prevUri) {
        // A different favorite: the old queue signature no longer describes this key.
        if (out.favoriteSignature) {
          out.favoriteSignature = null;
          corrected = true;
        }
      } else if (prev.favoriteSignature && !signaturesEqual(out.favoriteSignature, prev.favoriteSignature)) {
        out.favoriteSignature = prev.favoriteSignature;
        corrected = true;
      }
    }
    return { settings: out, corrected };
  }

  handlers.didReceiveSettings = (msg) => {
    const prev = getActionSettings(msg.context) ?? {};
    const guarded = guardPluginOwnedFields(prev, msg.payload?.settings ?? {});
    const incoming = guarded.settings;
    const merged = { ...prev, ...incoming, status: prev.status ?? {} };
    setActionSettings(msg.context, merged);
    if (guarded.corrected) sd.saveSettings?.({ actionSettings: persistable(merged), context: msg.context });

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
    renderNow(msg.context);
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
