import { getSpeaker, updateSpeakerState, setOperationalStatus } from "./SonosSpeakers.js";
import { OPERATIONAL_STATUS } from "./operationalStatus.js";

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
  { actionSettings, showAlert, refreshStateAndTitle = () => {} },
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

  try {
    for (const handler of handlers) {
      const result = await handler({
        inContext,
        inActionSettings: settings,
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

    setOperationalStatus({ UUID: uuid, operationalStatus: OPERATIONAL_STATUS.UPDATED });

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
