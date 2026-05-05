/**
 * Stream Deck SDK lifecycle handlers.
 *
 * Translates inbound SDK events into mutations on `actionSettings` (etr.4)
 * and the `SonosSpeakers` store (etr.1), and routes input events into
 * the action dispatcher (etr.4) / dialRotate debouncer (etr.6).
 *
 *   willAppear           → register context with speaker, cache settings
 *   willDisappear        → remove context from speaker, drop cached settings
 *   didReceiveSettings   → re-cache; on UUID change, moveContext
 *   globalsettings       → mirror payload into the globalSettings ref
 *   systemDidWakeUp      → no-op (polling re-converges naturally)
 *   keyDown / dialDown / touchTap → callAction(...) directly
 *   dialRotate           → handleDialRotate(...) (300ms debounce)
 *   keyUp / dialUp       → NOT subscribed (no long-press semantics)
 *
 * See backend.md "Lifecycle hooks consumed" and prd-what.md §3.2 / §11.2.
 */

import {
  addContext,
  removeContext,
  moveContext,
} from "./SonosSpeakers.js";
import {
  setActionSettings,
  getActionSettings,
  deleteActionSettings,
} from "./actionSettings.js";
import { setGlobalSettings } from "./globalSettings.js";
import { callAction as defaultCallAction } from "./actionDispatcher.js";
import {
  handleDialRotate as defaultHandleDialRotate,
  cleanupDialRotate,
} from "./dialRotateDebouncer.js";
import { clearDedupeCache } from "./renderDedupe.js";

/**
 * Wire all lifecycle handlers onto an SDK client. Returns a teardown
 * function that removes every listener (so dev-mode hot reload doesn't
 * stack subscribers).
 *
 * @param {object} args
 * @param {object} args.sd — Stream Deck client (an EventEmitter).
 * @param {object} [deps] — Test injectables (default to real impls).
 */
export function wireLifecycleHandlers({ sd } = {}, deps = {}) {
  if (!sd) return () => {};
  const callAction = deps.callAction ?? defaultCallAction;
  const handleDialRotate = deps.handleDialRotate ?? defaultHandleDialRotate;

  const onWillAppear = (msg) => {
    const context = msg?.context;
    const payload = msg?.payload ?? {};
    const settings = payload.settings ?? {};
    setActionSettings(context, {
      action: msg?.action,
      controller: payload.controller,
      currentStateIndex: payload.state ?? 0,
      ...settings,
      status: {},
    });
    if (settings.uuid) {
      addContext({
        UUID: settings.uuid,
        context,
        hostAddress: settings.hostAddress,
        zoneName: settings.zoneName,
      });
    }
  };

  const onWillDisappear = (msg) => {
    const context = msg?.context;
    const cached = getActionSettings(context);
    if (cached?.uuid) {
      removeContext({ UUID: cached.uuid, context });
    }
    cleanupDialRotate(context);
    deleteActionSettings(context);
  };

  const onDidReceiveSettings = (msg) => {
    const context = msg?.context;
    const incoming = msg?.payload?.settings ?? {};
    const previous = getActionSettings(context) ?? {};
    setActionSettings(context, {
      ...previous,
      ...incoming,
      status: previous.status ?? {},
    });
    if (previous.uuid && incoming.uuid && previous.uuid !== incoming.uuid) {
      moveContext({
        fromUUID: previous.uuid,
        toUUID: incoming.uuid,
        context,
        hostAddress: incoming.hostAddress,
        zoneName: incoming.zoneName,
      });
      // Bound speaker changed — drop the dedupe cache so the first poll on
      // the new speaker emits all fields (etr.7 contract).
      clearDedupeCache(context);
    } else if (!previous.uuid && incoming.uuid) {
      // First binding — willAppear ran with no uuid (rare, but covered).
      addContext({
        UUID: incoming.uuid,
        context,
        hostAddress: incoming.hostAddress,
        zoneName: incoming.zoneName,
      });
    }
  };

  const onGlobalSettings = (settings) => {
    setGlobalSettings(settings);
  };

  const onSystemDidWakeUp = () => {
    // No-op: the polling supervisor re-converges naturally because every
    // speaker's `lastChecked` is stale after sleep.
  };

  const onKeyDown = (msg) => {
    callAction({ inContext: msg?.context, inEvent: "keyDown" });
  };

  const onDialDown = (msg) => {
    callAction({ inContext: msg?.context, inEvent: "dialDown" });
  };

  const onTouchTap = (msg) => {
    callAction({ inContext: msg?.context, inEvent: "touchTap" });
  };

  const onDialRotate = (msg) => {
    handleDialRotate({
      context: msg?.context,
      ticks: msg?.payload?.ticks ?? 0,
    });
  };

  sd.on("willAppear", onWillAppear);
  sd.on("willDisappear", onWillDisappear);
  sd.on("didReceiveSettings", onDidReceiveSettings);
  sd.on("globalsettings", onGlobalSettings);
  sd.on("systemDidWakeUp", onSystemDidWakeUp);
  sd.on("keyDown", onKeyDown);
  sd.on("dialDown", onDialDown);
  sd.on("touchTap", onTouchTap);
  sd.on("dialRotate", onDialRotate);
  // Note: keyUp / dialUp deliberately NOT subscribed.

  return function teardownLifecycleHandlers() {
    sd.off("willAppear", onWillAppear);
    sd.off("willDisappear", onWillDisappear);
    sd.off("didReceiveSettings", onDidReceiveSettings);
    sd.off("globalsettings", onGlobalSettings);
    sd.off("systemDidWakeUp", onSystemDidWakeUp);
    sd.off("keyDown", onKeyDown);
    sd.off("dialDown", onDialDown);
    sd.off("touchTap", onTouchTap);
    sd.off("dialRotate", onDialRotate);
  };
}
