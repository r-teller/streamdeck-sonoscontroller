/**
 * Pure builder for the global-settings persistence payload written by
 * `PiComponent.saveGlobalSettings()`.
 *
 * Owns the silent `Math.max(1, value)` clamp on `adjustVolumeIncrement`
 * at the write site (HTML `min="1"` is bypassable in the Stream Deck
 * Electron webview's `v-model.number` binding, so input-side validation
 * alone is insufficient).
 *
 * Schema reference: data-model.md §Shape:GlobalSettings,
 * frontend.md §"Settings Persistence — Global settings".
 */
export function buildGlobalSettingsPayload({
  devices,
  deviceCheckInterval,
  deviceTimeoutDuration,
  adjustVolumeIncrement,
  favorites,
}) {
  return {
    devices,
    deviceCheckInterval,
    deviceTimeoutDuration,
    adjustVolumeIncrement: clampVolumeIncrement(adjustVolumeIncrement),
    favorites,
  };
}

/**
 * Clamp the volume increment to a minimum of 1. Coerces strings (form-bound
 * inputs come through as strings even with `v-model.number` in some edge
 * cases). Non-numeric input yields the clamp floor of 1.
 */
export function clampVolumeIncrement(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, n);
}
