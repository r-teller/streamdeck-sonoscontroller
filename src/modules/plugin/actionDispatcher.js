/**
 * Action dispatcher.
 *
 * `actionFunctionMap` is a registry keyed by the last segment of an action
 * UUID (e.g. `toggle-mute-unmute`). Each entry has slots for SDK input
 * events (`keyDown`, `dialRotate`, `dialDown`, `touchTap`) plus a `state`
 * namespace consumed by the render path (etr.7).
 *
 * Phase 3 ships the registry as an empty skeleton — Phase 5 (km1.*) drops
 * handler functions into the appropriate slots. Mutating the slots after
 * load is intentional: the dispatcher reads through the map on every call,
 * so late registration just works.
 *
 * `callAction({inContext, inEvent, inRotation})` translates an inbound SDK
 * event into a handler invocation, sets OPERATIONAL_STATUS.UPDATING,
 * awaits the handler, and either applies an optimistic state projection
 * (success) or surfaces an alert + flips to DISCONNECTED (failure).
 *
 * See backend.md §"Action Dispatcher" and prd-what.md §5 / §11.2.
 */

import {
  getSpeaker,
  setOperationalStatus,
  updateSpeakerState,
  sonosSpeakers,
} from "./SonosSpeakers.js";
import { OPERATIONAL_STATUS } from "./operationalStatus.js";
import { actionSettings as defaultActionSettings } from "./actionSettings.js";

const ACTION_SHORT_NAMES = [
  "currently-playing",
  "toggle-mute-unmute",
  "toggle-play-pause",
  "toggle-play-mode",
  "toggle-input-source",
  "play-next-track",
  "play-previous-track",
  "volume-up",
  "volume-down",
  "play-sonos-favorite",
  "encoder-audio-equalizer",
];

function emptyEntry() {
  return {
    keyDown: [],
    dialRotate: [],
    dialDown: [],
    touchTap: [],
    state: { default: null, keypad: null, encoder: null },
  };
}

export const actionFunctionMap = Object.fromEntries(
  ACTION_SHORT_NAMES.map((name) => [name, emptyEntry()]),
);

/**
 * Dispatch an inbound SDK event to the registered handler(s).
 *
 * Side-effecting: sets operational status, applies optimistic projection,
 * invokes `showAlert` on failure. Never throws — unknown contexts and
 * unregistered actions are soft-dropped with a log line.
 *
 * @param {object} args
 * @param {string} args.inContext — Stream Deck context ID.
 * @param {string} args.inEvent — `keyDown` | `dialRotate` | `dialDown` | `touchTap`.
 * @param {number} [args.inRotation] — dial tick total; only meaningful for `dialRotate`.
 * @param {object} [deps] — Injectables for testing.
 * @param {object} [deps.actionSettings] — per-context settings store.
 * @param {Function} [deps.showAlert] — Stream Deck SDK helper.
 */
export async function callAction(
  { inContext, inEvent, inRotation } = {},
  {
    actionSettings = defaultActionSettings,
    showAlert,
  } = {},
) {
  const settings = actionSettings[inContext];
  if (!settings) {
    console.log(`[dispatcher] unknown context: ${inContext}`);
    return;
  }
  const actionShortName = String(settings.action || "").split(".").pop();
  const entry = actionFunctionMap[actionShortName];
  if (!entry) {
    console.log(`[dispatcher] unknown action short-name: ${actionShortName}`);
    return;
  }
  const handlers = entry[inEvent];
  if (!Array.isArray(handlers) || handlers.length === 0) {
    return;
  }

  const uuid = settings.uuid;
  if (!uuid) {
    console.log(`[dispatcher] context ${inContext} has no bound speaker uuid`);
    return;
  }

  setOperationalStatus({ UUID: uuid, operationalStatus: OPERATIONAL_STATUS.UPDATING });
  // Rate limiter (etr.2) may have just tripped us. Soft-drop the call —
  // user input mashing should not stack handler invocations on a saturated
  // speaker.
  if (sonosSpeakers[uuid]?.operationalStatus === OPERATIONAL_STATUS.RATE_LIMITED) {
    return;
  }

  try {
    const speaker = getSpeaker({ UUID: uuid });
    for (const handler of handlers) {
      const result = await handler({
        inContext,
        inActionSettings: settings,
        inSonosSpeakerState: speaker.state,
        inRotation,
      });
      if (!result || result.status === "ERROR") {
        throw new Error(`handler returned ERROR for ${actionShortName}`);
      }
      if (result.updatedSonosSpeakerState) {
        updateSpeakerState({
          UUID: uuid,
          state: result.updatedSonosSpeakerState,
          updateLastChecked: false,
        });
      }
    }
    setOperationalStatus({ UUID: uuid, operationalStatus: OPERATIONAL_STATUS.UPDATED });
  } catch (_err) {
    setOperationalStatus({
      UUID: uuid,
      operationalStatus: OPERATIONAL_STATUS.DISCONNECTED,
    });
    if (showAlert) {
      const contexts = [...(sonosSpeakers[uuid]?.contexts ?? [])];
      for (const ctx of contexts) {
        showAlert({ context: ctx });
      }
    }
  }
}

/**
 * Reset the registry to empty slots. Test-only — production code never
 * unregisters handlers.
 */
export function _resetActionFunctionMap() {
  for (const name of ACTION_SHORT_NAMES) {
    actionFunctionMap[name] = emptyEntry();
  }
}
