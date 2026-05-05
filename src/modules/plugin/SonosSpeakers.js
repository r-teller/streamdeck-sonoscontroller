/**
 * Plugin-process speaker store.
 *
 * Single source of truth for per-speaker state inside the plugin background.
 * Keyed by Sonos `UUID`. Vue 3 `reactive({})` so downstream consumers
 * (polling supervisor, render layer, debug panels) observe mutations.
 *
 * Module is itself a singleton (ES modules evaluate once), so every import
 * sees the same `sonosSpeakers` reference.
 *
 * See backend.md §"Speaker store" for the surrounding semantics.
 */

import { reactive } from "vue";
import { OPERATIONAL_STATUS } from "./operationalStatus.js";

export const sonosSpeakers = reactive({});

// Sliding-window rate limit: more than MAX_UPDATES UPDATING transitions in
// TIME_WINDOW_SECONDS forces the speaker to RATE_LIMITED. UPDATED resets.
// See prd-what.md §8.3 and backend.md "Rate limiting".
export const MAX_UPDATES = 3;
export const TIME_WINDOW_SECONDS = 10;

function nowSeconds() {
  return Date.now() / 1000;
}

function newRecord() {
  return {
    contexts: [],
    operationalStatus: OPERATIONAL_STATUS.UNINITIALIZED,
    state: {},
    updateAttempts: [],
    lastChecked: null,
    lastUpdated: null,
  };
}

export function getSpeaker({ UUID }) {
  if (!sonosSpeakers[UUID]) {
    sonosSpeakers[UUID] = newRecord();
  }
  return sonosSpeakers[UUID];
}

export function addContext({ UUID, context, hostAddress, zoneName }) {
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
  return speaker;
}

export function removeContext({ UUID, context }) {
  const speaker = sonosSpeakers[UUID];
  if (!speaker) return false;
  speaker.contexts = speaker.contexts.filter((c) => c !== context);
  if (speaker.contexts.length === 0) {
    delete sonosSpeakers[UUID];
    return true;
  }
  return false;
}

export function moveContext({ fromUUID, toUUID, context, hostAddress, zoneName }) {
  removeContext({ UUID: fromUUID, context });
  addContext({ UUID: toUUID, context, hostAddress, zoneName });
}

export function updateSpeakerState({ UUID, state, updateLastChecked = false }) {
  const speaker = getSpeaker({ UUID });
  for (const key of Object.keys(state || {})) {
    if (key === "audioEqualizer") {
      speaker.state.audioEqualizer = {
        ...(speaker.state.audioEqualizer || {}),
        ...(state.audioEqualizer || {}),
      };
    } else {
      speaker.state[key] = state[key];
    }
  }
  if (updateLastChecked) {
    const ts = nowSeconds();
    speaker.lastChecked = ts;
    speaker.lastUpdated = ts;
  }
  return speaker;
}

export function setOperationalStatus({ UUID, operationalStatus }) {
  const speaker = getSpeaker({ UUID });
  if (operationalStatus === OPERATIONAL_STATUS.UPDATING) {
    const now = nowSeconds();
    speaker.updateAttempts.push(now);
    speaker.updateAttempts = speaker.updateAttempts.filter(
      (ts) => now - ts <= TIME_WINDOW_SECONDS,
    );
    if (speaker.updateAttempts.length > MAX_UPDATES) {
      speaker.operationalStatus = OPERATIONAL_STATUS.RATE_LIMITED;
      return speaker;
    }
  }
  if (operationalStatus === OPERATIONAL_STATUS.UPDATED) {
    speaker.updateAttempts = [];
  }
  speaker.operationalStatus = operationalStatus;
  return speaker;
}

export function getAllSpeakers() {
  return sonosSpeakers;
}
