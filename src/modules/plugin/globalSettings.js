/**
 * Plugin-process global settings — a Vue ref that mirrors the most recent
 * `didReceiveGlobalSettings` payload from the Stream Deck SDK. Polling
 * supervisor (etr.3) and action handlers (Phase 5) read from this ref so a
 * change in PI-saved global settings is observed without restart.
 *
 * Module is a singleton (ES module evaluation guarantees this).
 */

import { ref } from "vue";

export const globalSettings = ref({});

export function setGlobalSettings(payload) {
  globalSettings.value = payload ?? {};
}
