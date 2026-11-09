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
 * @param {boolean} [options.advanceMarquee=false] - only the render ticker advances scrolling text
 */
export function refreshStateAndTitle({ inContext, inSonosSpeakerState, force = false, advanceMarquee = false }) {
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

  const intent = stateFn({ inContext, inActionSettings: settings, inSonosSpeakerState, advanceMarquee });
  if (!intent) return;

  // Ensure status exists
  if (!settings.status) {
    settings.status = {};
  }
  const status = settings.status;

  // stateIndex first: Stream Deck applies setImage/setTitle to the current state only, so after a
  // state change the image and title must be re-sent or the new state shows its default icon.
  let stateChanged = false;
  if (intent.stateIndex !== undefined) {
    if (force || intent.stateIndex !== status.lastStateIndex) {
      sd.setState({ context: inContext, stateIndex: intent.stateIndex });
      stateChanged = status.lastStateIndex !== undefined && intent.stateIndex !== status.lastStateIndex;
      status.lastStateIndex = intent.stateIndex;
    }
  }
  if (stateChanged) force = true;

  // imageDataURL
  if (intent.imageDataURL !== undefined) {
    if (force || intent.imageDataURL !== status.lastImageDataURL) {
      sd.setImage({ context: inContext, image: intent.imageDataURL });
      status.lastImageDataURL = intent.imageDataURL;
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
        // Unchanged source: emit only when the visible window moved (the marquee ticker re-renders
        // often; short titles that do not scroll must not resend every tick).
        if (intent.title !== status.lastTitleValue) {
          sd.setTitle({ context: inContext, title: intent.title });
          status.lastTitleValue = intent.title;
        }
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

  // feedbackLayout first: setting a layout resets the touch strip to the layout's defaults, so the
  // values must be sent after it (and re-sent whenever the layout changes), otherwise the dial stays
  // empty until the next value change (sonos-280).
  let layoutChanged = false;
  if (intent.feedbackLayout !== undefined) {
    if (force || intent.feedbackLayout !== status.lastAudioEqualizerLayout) {
      sd.setFeedbackLayout({ context: inContext, payload: { layout: intent.feedbackLayout } });
      status.lastAudioEqualizerLayout = intent.feedbackLayout;
      layoutChanged = true;
    }
  }

  // feedback (shallow equality)
  if (intent.feedback !== undefined && typeof intent.feedback === "object" && intent.feedback !== null) {
    if (force || layoutChanged || !shallowEqual(intent.feedback, status.lastFeedback)) {
      sd.setFeedback({ context: inContext, payload: intent.feedback });
      status.lastFeedback = intent.feedback;
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
