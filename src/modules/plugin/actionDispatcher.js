import { getSpeaker, updateSpeakerState, setOperationalStatus, bumpStateVersion } from "./SonosSpeakers.js";
import { OPERATIONAL_STATUS } from "./operationalStatus.js";
import { resolveSpeaker } from "../common/speakerResolver.js";
import { globalSettings } from "./globalSettings.js";

/**
 * Settings handed to action handlers, with uuid/hostAddress pointed at the resolved speaker
 * (new IP, replacement or same-room speaker). Returns the original object when nothing changed.
 */
export function withResolvedSpeaker(settings, globals = globalSettings) {
  const resolved = resolveSpeaker(settings, globals);
  if (resolved.uuid === settings.uuid && resolved.hostAddress === settings.hostAddress) {
    return settings;
  }
  return { ...settings, uuid: resolved.uuid, hostAddress: resolved.hostAddress };
}

const ACTION_NAMES = [
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
  "encoder-play-mode",
  "encoder-queue-track",
];

function createEmptyEntry() {
  return {
    keyDown: [],
    dialRotate: [],
    dialDown: [],
    touchTap: [],
    state: { default: null, keypad: null, encoder: null },
  };
}

export const actionFunctionMap = {};
for (const name of ACTION_NAMES) {
  actionFunctionMap[name] = createEmptyEntry();
}

export function _resetActionFunctionMap() {
  for (const name of ACTION_NAMES) {
    actionFunctionMap[name] = createEmptyEntry();
  }
}

export async function callAction(
  { inContext, inEvent, inRotation },
  { actionSettings, showAlert, refreshStateAndTitle = () => {}, afterAction = () => {} },
) {
  const settings = actionSettings[inContext];
  if (!settings) {
    console.warn(`[actionDispatcher] No settings for context: ${inContext}`);
    return;
  }

  const shortName = settings.action?.split(".").pop();
  if (!actionFunctionMap[shortName]) {
    console.warn(`[actionDispatcher] Unknown action: ${settings.action}`);
    return;
  }

  const uuid = settings.uuid;
  if (!uuid) {
    console.warn(`[actionDispatcher] Missing UUID in settings for context: ${inContext}`);
    return;
  }

  const handlers = actionFunctionMap[shortName][inEvent] ?? [];
  if (handlers.length === 0) {
    return;
  }

  const speaker = getSpeaker({ UUID: uuid });
  if (!speaker) {
    console.warn(`[actionDispatcher] No speaker found for UUID: ${uuid}`);
    return;
  }

  setOperationalStatus({ UUID: uuid, operationalStatus: OPERATIONAL_STATUS.UPDATING });

  if (speaker.operationalStatus === OPERATIONAL_STATUS.RATE_LIMITED) {
    return;
  }

  const handlerSettings = withResolvedSpeaker(settings);
  // Any poll already in flight read the speaker before this action: drop its result (sonos-e9y).
  bumpStateVersion({ UUID: uuid });

  try {
    for (const handler of handlers) {
      const result = await handler({
        inContext,
        inActionSettings: handlerSettings,
        inSonosSpeakerState: speaker.state,
        inRotation,
      });

      if (!result || result.status === "ERROR") {
        throw new Error(`Handler failed: ${result?.message ?? "Unknown error"}`);
      }

      if (result.updatedSonosSpeakerState) {
        updateSpeakerState({ UUID: uuid, state: result.updatedSonosSpeakerState });
      }
    }

    // Polls that started while the handler ran may have read pre-action state too.
    bumpStateVersion({ UUID: uuid });
    setOperationalStatus({ UUID: uuid, operationalStatus: OPERATIONAL_STATUS.UPDATED });
    // Confirm the projection with a fresh read on the next tick.
    const after = getSpeaker({ UUID: uuid });
    if (after) after.lastChecked = 0;
    try {
      afterAction({ UUID: uuid, inContext });
    } catch (e) {
      // bookkeeping only
    }

    // Optimistic projection: re-read speaker and refresh all contexts
    const updatedSpeaker = getSpeaker({ UUID: uuid });
    if (updatedSpeaker?.contexts) {
      for (const context of updatedSpeaker.contexts) {
        refreshStateAndTitle({
          inContext: context,
          inSonosSpeakerState: updatedSpeaker.state,
        });
      }
    }
  } catch (err) {
    setOperationalStatus({ UUID: uuid, operationalStatus: OPERATIONAL_STATUS.DISCONNECTED });
    if (speaker?.contexts) {
      try {
        for (const context of speaker.contexts) {
          showAlert({ context });
        }
      } catch (e) {
        // Swallow errors from showAlert to ensure callAction never throws
      }
    }
  }
}
