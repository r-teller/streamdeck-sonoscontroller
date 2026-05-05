/**
 * Helpers shared by every action handler.
 */

import { SonosController } from "@/modules/common/sonosController.js";
import { globalSettings } from "@/modules/plugin/globalSettings.js";

/**
 * Construct a fresh SonosController bound to the given host. Per
 * backend.md "Construct a fresh `SonosController` per action call" —
 * never reuse instances across calls.
 */
export function makeController(hostAddress) {
  const c = new SonosController();
  c.connect(hostAddress);
  return c;
}

/**
 * Resolve the action-call timeout from global settings. Polling uses 5s;
 * actions get the longer 10s budget per prd-what.md §6.
 */
export function actionTimeoutMs() {
  return (globalSettings.value.deviceTimeoutDuration ?? 10) * 1000;
}

/**
 * Race a SOAP promise against the action timeout. Throws on timeout
 * with a human-readable message.
 */
export async function raceWithTimeout(promise, label = "action") {
  const ms = actionTimeoutMs();
  let handle;
  const timeout = new Promise((_, reject) => {
    handle = setTimeout(
      () => reject(new Error(`Timeout while running ${label} after ${ms / 1000} seconds`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(handle);
  }
}

/**
 * Resolve the volume-up/down increment for a context. Per-button override
 * wins; otherwise fall back to the global setting; otherwise 10. Uses
 * `??` (NOT `||`) so a value of 1 is preserved (PR #4 regression).
 */
export function resolveVolumeIncrement(inActionSettings) {
  const perButton = inActionSettings?.adjustVolumeIncrement;
  if (typeof perButton === "number" && perButton >= 1) return perButton;
  const globalIncrement = globalSettings.value.adjustVolumeIncrement;
  if (typeof globalIncrement === "number" && globalIncrement >= 1) return globalIncrement;
  return 10;
}

export const PLAY_MODES = [
  "NORMAL",
  "SHUFFLE_NOREPEAT",
  "SHUFFLE_REPEAT_ONE",
  "SHUFFLE",
  "REPEAT_ONE",
  "REPEAT_ALL",
];

export const INPUT_SOURCES = ["SONOS_QUEUE", "TV_INPUT", "LINE_IN"];
