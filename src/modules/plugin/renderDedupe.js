import { getActionSettings } from "./actionSettings.js";
import { actionFunctionMap } from "./actionDispatcher.js";
import { getStreamDeckClient } from "../common/sdConnect.js";

/**
 * Shallow equality check for objects: same key count and === per key
 * @param {Object} a
 * @param {Object} b
 * @returns {boolean}
 */
function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!(key in b) || a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * Refresh state and title for a given context, emitting only changed fields
 * @param {Object} options
 * @param {string} options.inContext
 * @param {Object} options.inSonosSpeakerState
 * @param {boolean} [options.force=false]
 */
export function refreshStateAndTitle({ inContext, inSonosSpeakerState, force = false }) {
  const settings = getActionSettings(inContext);
  if (!settings) return;

  const shortName = settings.action?.split(".").pop();
  if (!shortName) return;

  const entry = actionFunctionMap[shortName];
  if (!entry) return;

  const controller = settings.controller;
  const stateFn = entry.state?.[controller?.toLowerCase()] ?? entry.state?.default;
  if (!stateFn) return;

  const sd = getStreamDeckClient();
  if (!sd) return;

  const intent = stateFn({ inContext, inActionSettings: settings, inSonosSpeakerState });
  if (!intent) return;

  // Ensure status exists
  if (!settings.status) {
    settings.status = {};
  }
  const status = settings.status;

  // imageDataURL
  if (intent.imageDataURL !== undefined) {
    if (force || intent.imageDataURL !== status.lastImageDataURL) {
      sd.setImage({ context: inContext, image: intent.imageDataURL });
      status.lastImageDataURL = intent.imageDataURL;
    }
  }

  // stateIndex
  if (intent.stateIndex !== undefined) {
    if (force || intent.stateIndex !== status.lastStateIndex) {
      sd.setState({ context: inContext, stateIndex: intent.stateIndex });
      status.lastStateIndex = intent.stateIndex;
    }
  }

  // title (with marquee carve-out)
  if (intent.title !== undefined) {
    if (intent.titleSource !== undefined && intent.titleSource !== null) {
      // Marquee mode: emit every frame if source unchanged, but emit on source change
      if (force || intent.titleSource !== status.lastTitleSource) {
        sd.setTitle({ context: inContext, title: intent.title });
        status.lastTitleSource = intent.titleSource;
        status.lastTitleValue = intent.title;
      } else {
        // Unchanged source: still emit setTitle every frame (no dedupe)
        sd.setTitle({ context: inContext, title: intent.title });
        status.lastTitleValue = intent.title;
      }
    } else {
      // Static title: dedupe on title value
      if (force || intent.title !== status.lastTitleValue) {
        sd.setTitle({ context: inContext, title: intent.title });
        status.lastTitleValue = intent.title;
        status.lastTitleSource = null;
      }
    }
  }

  // feedback (shallow equality)
  if (intent.feedback !== undefined && typeof intent.feedback === "object" && intent.feedback !== null) {
    if (force || !shallowEqual(intent.feedback, status.lastFeedback)) {
      sd.setFeedback({ context: inContext, payload: intent.feedback });
      status.lastFeedback = intent.feedback;
    }
  }

  // feedbackLayout
  if (intent.feedbackLayout !== undefined) {
    if (force || intent.feedbackLayout !== status.lastAudioEqualizerLayout) {
      sd.setFeedbackLayout({ context: inContext, payload: intent.feedbackLayout });
      status.lastAudioEqualizerLayout = intent.feedbackLayout;
    }
  }
}

/**
 * Clear dedupe cache for a given context
 * @param {string} context
 */
export function clearDedupeCache(context) {
  const settings = getActionSettings(context);
  if (settings) {
    settings.status = {};
  }
}

// Export helper for tests or debugging
export { shallowEqual };
