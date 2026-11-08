/**
 * Default values for global settings.
 */
export const GLOBAL_DEFAULTS = Object.freeze({ deviceCheckInterval: 10, deviceTimeoutDuration: 10, adjustVolumeIncrement: 10 });

/**
 * Clamps volume increment to at least 1.
 * @param {number} value
 * @returns {number}
 */
export function clampVolumeIncrement(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, n) : 1;
}

/**
 * Coerces a seconds value to a finite number ≥ 1, or returns fallback.
 * @param {number} value
 * @param {number} fallback
 * @returns {number}
 */
export function coerceSeconds(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

/**
 * Builds a validated global settings payload for `setGlobalSettings`.
 * @param {Object} params
 * @param {Object} [params.devices]
 * @param {number} [params.deviceCheckInterval]
 * @param {number} [params.deviceTimeoutDuration]
 * @param {number} [params.adjustVolumeIncrement]
 * @param {Array} [params.favorites]
 * @param {Object} [params.speakerReplacements] - old speaker uuid -> new speaker uuid
 * @returns {Object}
 */
export function buildGlobalSettingsPayload({
  devices,
  deviceCheckInterval,
  deviceTimeoutDuration,
  adjustVolumeIncrement,
  favorites,
  speakerReplacements,
}) {
  return {
    devices: devices ?? {},
    deviceCheckInterval: coerceSeconds(deviceCheckInterval, GLOBAL_DEFAULTS.deviceCheckInterval),
    deviceTimeoutDuration: coerceSeconds(deviceTimeoutDuration, GLOBAL_DEFAULTS.deviceTimeoutDuration),
    adjustVolumeIncrement: clampVolumeIncrement(adjustVolumeIncrement ?? GLOBAL_DEFAULTS.adjustVolumeIncrement),
    favorites: Array.isArray(favorites) ? [...favorites] : [],
    speakerReplacements: cleanReplacements(speakerReplacements),
  };
}

/**
 * Keeps only string -> string entries that do not map a speaker to itself.
 * @param {Object} [map]
 * @returns {Object}
 */
export function cleanReplacements(map) {
  const out = {};
  for (const [from, to] of Object.entries(map ?? {})) {
    if (typeof from === "string" && typeof to === "string" && from && to && from !== to) out[from] = to;
  }
  return out;
}
