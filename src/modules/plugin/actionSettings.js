/**
 * Per-context action settings — a reactive map keyed by Stream Deck context
 * (the opaque per-instance ID issued by the host). Maintained by the
 * lifecycle handlers (etr.5) on willAppear / willDisappear /
 * didReceiveSettings, and consumed by the action dispatcher (etr.4).
 *
 * Entries shape:
 *   {
 *     action: string,          // full action UUID, e.g. com.r-teller....toggle-mute-unmute
 *     controller: 'Keypad' | 'Encoder',
 *     uuid: string,            // bound speaker UUID (RINCON_xxx)
 *     hostAddress: string,
 *     zoneName: string,
 *     currentStateIndex: number,
 *     ...persisted action settings (selectedPlayModes, displayAlbumArt, etc.)
 *   }
 *
 * Module is a singleton — every import of `actionSettings` returns the same
 * reactive object. ES module evaluation guarantees this.
 */

import { reactive } from "vue";

export const actionSettings = reactive({});

export function setActionSettings(context, settings) {
  actionSettings[context] = settings;
}

export function getActionSettings(context) {
  return actionSettings[context];
}

export function deleteActionSettings(context) {
  delete actionSettings[context];
}
