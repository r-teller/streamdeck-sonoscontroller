/**
 * Per-context render dedupe.
 *
 * `refreshStateAndTitle({inContext, inSonosSpeakerState, force})` resolves
 * the action's state-rendering function from the dispatcher registry,
 * derives a render-intent object, and emits SDK calls (setImage / setState
 * / setTitle / setFeedback / setFeedbackLayout) ONLY when fields differ
 * from the last-pushed values for that context.
 *
 * Scratchpad lives at `actionSettings[inContext].status` (initialized by
 * etr.5's willAppear). Marquee carve-out: when render-intent carries a
 * `titleSource`, dedupe on that rather than the per-frame substring.
 *
 * See prd-what.md §8.2 and backend.md "Render dedupe (no flashing)".
 */

import { actionFunctionMap } from "./actionDispatcher.js";
import { actionSettings as defaultActionSettings } from "./actionSettings.js";
import { getStreamDeckClient } from "@/modules/common/sdConnect.js";

function defaultGetClient() {
  return getStreamDeckClient();
}

function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/**
 * Render the current state for `inContext` and emit the deduped SDK calls.
 *
 * @param {object} args
 * @param {string} args.inContext — Stream Deck context ID.
 * @param {object} args.inSonosSpeakerState — Current speaker state (from
 *   the SonosSpeakers store).
 * @param {boolean} [args.force=false] — Bypass dedupe; emit every field.
 * @param {object} [deps] — Test injectables.
 * @param {object} [deps.actionSettings] — Per-context settings store.
 * @param {Function} [deps.getClient] — Returns the SDK client.
 */
export function refreshStateAndTitle(
  { inContext, inSonosSpeakerState, force = false } = {},
  { actionSettings = defaultActionSettings, getClient = defaultGetClient } = {},
) {
  const settings = actionSettings[inContext];
  if (!settings) return;
  const actionShortName = String(settings.action || "").split(".").pop();
  const entry = actionFunctionMap[actionShortName];
  if (!entry) return;
  const controllerKey = String(settings.controller || "").toLowerCase();
  const stateFn =
    entry.state?.[controllerKey] ??
    entry.state?.default ??
    null;
  if (!stateFn) return;

  const intent = stateFn(settings, inSonosSpeakerState) || {};
  const sd = getClient();
  if (!sd) return;
  if (!settings.status) settings.status = {};
  const status = settings.status;

  // setImage
  if (intent.imageDataURL !== undefined && intent.imageDataURL !== null) {
    if (force || status.lastImageDataURL !== intent.imageDataURL) {
      sd.setImage({ context: inContext, image: intent.imageDataURL });
      status.lastImageDataURL = intent.imageDataURL;
    }
  }

  // setState
  if (intent.stateIndex !== undefined && intent.stateIndex !== null) {
    if (force || status.lastStateIndex !== intent.stateIndex) {
      sd.setState({ context: inContext, stateIndex: intent.stateIndex });
      status.lastStateIndex = intent.stateIndex;
    }
  }

  // setTitle — marquee carve-out: if titleSource present, dedupe on it; the
  // per-frame `title` substring still goes through to the SDK so the
  // marquee animates.
  if (intent.title !== undefined && intent.title !== null) {
    if (intent.titleSource !== undefined && intent.titleSource !== null) {
      if (force || status.lastTitleSource !== intent.titleSource) {
        sd.setTitle({ context: inContext, title: intent.title });
        status.lastTitleSource = intent.titleSource;
        status.lastTitleValue = intent.title;
      } else {
        // Same source, animating frames — push every frame; do NOT
        // dedupe per-frame title strings against lastTitleValue.
        sd.setTitle({ context: inContext, title: intent.title });
        status.lastTitleValue = intent.title;
      }
    } else if (force || status.lastTitleValue !== intent.title) {
      sd.setTitle({ context: inContext, title: intent.title });
      status.lastTitleValue = intent.title;
      // Static title — clear any prior marquee source.
      status.lastTitleSource = null;
    }
  }

  // setFeedback — per-field diff; SDK does not support partial updates so
  // emit the full new object whenever any field differs.
  if (intent.feedback && typeof intent.feedback === "object") {
    if (force || !shallowEqual(status.lastFeedback, intent.feedback)) {
      sd.setFeedback({ context: inContext, payload: intent.feedback });
      status.lastFeedback = { ...intent.feedback };
    }
  }

  // setFeedbackLayout
  if (intent.feedbackLayout !== undefined && intent.feedbackLayout !== null) {
    if (force || status.lastAudioEqualizerLayout !== intent.feedbackLayout) {
      sd.setFeedbackLayout({
        context: inContext,
        payload: intent.feedbackLayout,
      });
      status.lastAudioEqualizerLayout = intent.feedbackLayout;
    }
  }
}

/**
 * Clear the dedupe cache for a single context. Called from etr.5's
 * `didReceiveSettings` UUID-change branch (so the first poll on the new
 * speaker emits all fields).
 */
export function clearDedupeCache(inContext, deps = {}) {
  const actionSettings = deps.actionSettings ?? defaultActionSettings;
  const settings = actionSettings[inContext];
  if (!settings) return;
  settings.status = {};
}
