import { reactive } from "vue";
import { OPERATIONAL_STATUS } from "./operationalStatus.js";

const MAX_UPDATES = 3;
const TIME_WINDOW_SECONDS = 10;

const sonosSpeakers = reactive({});

function getSpeaker({ UUID }) {
  if (!sonosSpeakers[UUID]) {
    sonosSpeakers[UUID] = {
      contexts: [],
      operationalStatus: OPERATIONAL_STATUS.UNINITIALIZED,
      state: {},
      updateAttempts: [],
      lastChecked: null,
      lastUpdated: null,
    };
  }
  return sonosSpeakers[UUID];
}

function addContext({ UUID, context, hostAddress, zoneName }) {
  const speaker = getSpeaker({ UUID });

  if (hostAddress !== undefined && speaker.hostAddress === undefined) {
    speaker.hostAddress = hostAddress;
  }
  if (zoneName !== undefined && speaker.zoneName === undefined) {
    speaker.zoneName = zoneName;
  }

  if (!speaker.contexts.includes(context)) {
    speaker.contexts.push(context);
  }
}

function removeContext({ UUID, context }) {
  const speaker = sonosSpeakers[UUID];
  if (!speaker) {
    return false;
  }

  const index = speaker.contexts.indexOf(context);
  if (index === -1) {
    return false;
  }

  speaker.contexts.splice(index, 1);

  if (speaker.contexts.length === 0) {
    delete sonosSpeakers[UUID];
  }

  return true;
}

function moveContext({ fromUUID, toUUID, context, hostAddress, zoneName }) {
  const removed = removeContext({ UUID: fromUUID, context });
  if (removed) {
    addContext({ UUID: toUUID, context, hostAddress, zoneName });
  }
  return removed;
}

function updateSpeakerState({ UUID, state, updateLastChecked = false }) {
  const speaker = getSpeaker({ UUID });

  for (const key in state) {
    if (key === "audioEqualizer") {
      speaker.state.audioEqualizer = {
        ...speaker.state.audioEqualizer,
        ...state.audioEqualizer,
      };
    } else {
      speaker.state[key] = state[key];
    }
  }

  if (updateLastChecked) {
    const now = Date.now() / 1000;
    speaker.lastChecked = now;
    speaker.lastUpdated = now;
  }
}

function setOperationalStatus({ UUID, operationalStatus }) {
  const speaker = getSpeaker({ UUID });

  if (operationalStatus === OPERATIONAL_STATUS.UPDATING) {
    const now = Date.now() / 1000;

    speaker.updateAttempts.push(now);
    speaker.updateAttempts = speaker.updateAttempts.filter((ts) => now - ts <= TIME_WINDOW_SECONDS);

    if (speaker.updateAttempts.length > MAX_UPDATES) {
      speaker.operationalStatus = OPERATIONAL_STATUS.RATE_LIMITED;
      return;
    }

    speaker.operationalStatus = OPERATIONAL_STATUS.UPDATING;
  } else if (operationalStatus === OPERATIONAL_STATUS.UPDATED) {
    speaker.updateAttempts = [];
    speaker.operationalStatus = OPERATIONAL_STATUS.UPDATED;
  } else {
    speaker.operationalStatus = operationalStatus;
  }
}

function getAllSpeakers() {
  return sonosSpeakers;
}

export {
  sonosSpeakers,
  MAX_UPDATES,
  TIME_WINDOW_SECONDS,
  getSpeaker,
  addContext,
  removeContext,
  moveContext,
  updateSpeakerState,
  setOperationalStatus,
  getAllSpeakers,
};
