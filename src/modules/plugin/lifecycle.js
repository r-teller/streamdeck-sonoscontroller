import { callAction as defaultCallAction, actionFunctionMap } from "./actionDispatcher.js";
import { browseTick, endBrowse, forgetContext, setCarouselRenderHook } from "./carousel.js";
import { setQueueLoadedHook } from "./queueCache.js";
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
    forgetContext(msg.context);
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

  /**
   * Stream Deck can redraw keys from the manifest (wake from sleep, device reconnect, title settings
   * edited in the app) without telling the plugin which images/titles it dropped. The dedupe cache
   * would then suppress re-sending unchanged values, leaving keys on defaults until something
   * changed (sonos-7x8). Forget what was sent, redraw from known state, and re-poll.
   */
  function redrawAll({ repoll }) {
    for (const speaker of Object.values(getAllSpeakers())) {
      if (repoll) speaker.lastChecked = 0;
      for (const context of speaker.contexts) {
        clearDedupeCache(context);
        renderNow(context);
      }
    }
  }

  // After sleep the cached speaker state is stale too: redraw what we know, then re-poll everything.
  handlers.systemDidWakeUp = () => redrawAll({ repoll: true });

  handlers.deviceDidConnect = () => redrawAll({ repoll: true });

  handlers.titleParametersDidChange = (msg) => {
    const settings = msg?.context ? getActionSettings(msg.context) : undefined;
    if (!settings) return;
    // Stream Deck may echo this event for the plugin's own setTitle; redrawing then would loop with
    // the marquee. Only react when the shown title is not the one we just sent.
    if (msg.payload?.title !== undefined && msg.payload.title === settings.status?.lastTitleValue) return;
    clearDedupeCache(msg.context);
    renderNow(msg.context);
  };

  handlers.keyDown = (msg) => {
    callAction({ inContext: msg.context, inEvent: "keyDown" }, dispatchDeps);
  };

  handlers.dialDown = (msg) => {
    callAction({ inContext: msg.context, inEvent: "dialDown" }, dispatchDeps);
  };

  handlers.touchTap = (msg) => {
    callAction({ inContext: msg.context, inEvent: "touchTap" }, dispatchDeps);
  };

  // Carousel dials redraw on every slide frame and when card art arrives; dedupe keeps unchanged
  // fields from being re-sent (no force).
  setCarouselRenderHook((context) => {
    const uuid = getActionSettings(context)?.uuid;
    const speaker = uuid ? getAllSpeakers()[uuid] : undefined;
    if (speaker?.state) refreshStateAndTitle({ inContext: context, inSonosSpeakerState: speaker.state });
  });

  // Queue dial cards fill in once the speaker's queue items have been fetched.
  setQueueLoadedHook((uuid) => {
    const speaker = getAllSpeakers()[uuid];
    for (const context of speaker?.contexts ?? []) {
      refreshStateAndTitle({ inContext: context, inSonosSpeakerState: speaker.state });
    }
  });

  handlers.dialRotate = (msg) => {
    const shortName = getActionSettings(msg.context)?.action?.split(".").pop();
    const entry = actionFunctionMap[shortName];
    const carousel = entry?.carousel === true;
    handleDialRotate({
      context: msg.context,
      ticks: msg.payload?.ticks ?? 0,
      settleMs: entry?.dialSettleMs,
      // Carousel dials move their selection on every tick; the action applies it once turning stops.
      onTick: carousel ? (ticks) => browseTick(msg.context, ticks) : undefined,
      dispatch: async (args) => {
        try {
          await callAction(args, dispatchDeps);
        } finally {
          if (carousel) {
            endBrowse(msg.context, args.inRotation);
            renderNow(msg.context);
          }
        }
      },
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
