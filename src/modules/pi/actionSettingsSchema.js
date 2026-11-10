import { FAVORITE_SHORT_NAME, FAVORITE_TOGGLE_DEFAULTS } from "../common/favoriteSettings.js";
export const PLAY_MODES = Object.freeze([
  "NORMAL",
  "SHUFFLE_NOREPEAT",
  "SHUFFLE_REPEAT_ONE",
  "SHUFFLE",
  "REPEAT_ONE",
  "REPEAT_ALL",
]);
export const INPUT_SOURCES = Object.freeze(["Sonos_Queue", "TV_Input", "Line_In"]);

export const STATE_BASED_TITLE_ACTIONS = new Set([
  "toggle-play-mode",
  "toggle-input-source",
  "toggle-play-pause",
  "toggle-mute-unmute",
  "volume-up",
  "volume-down",
  "play-previous-track",
  "play-next-track",
]);
/** Actions that cycle play modes and honour the `selectedPlayModes` subset (key and dial). */
export const PLAY_MODE_ACTIONS = new Set(["toggle-play-mode", "encoder-play-mode"]);

// play-sonos-favorite uses its own five toggles (FAVORITE_TOGGLE_DEFAULTS), not these (sonos-gw5).
export const MARQUEE_TITLE_ACTIONS = new Set(["currently-playing"]);
/** What pushing the Audio Equalizer dial does (sonos-6sp). Rotation still adjusts the EQ target. */
export const ENCODER_PUSH_ACTIONS = Object.freeze(["NONE", "TOGGLE_MUTE", "TOGGLE_PLAY_PAUSE", "NEXT_TRACK"]);

export const MARQUEE_ALBUM_TITLE_ACTIONS = new Set(["toggle-play-pause", "currently-playing"]);
export const ALBUM_ART_ACTIONS = new Set(["toggle-play-pause", "currently-playing"]);

/**
 * Extracts the short name from an action UUID (segment after the last `.`).
 * @param {string} actionUUID - The full action UUID.
 * @returns {string} The short name, or empty string for invalid input.
 */
export function actionShortName(actionUUID) {
  if (!actionUUID || typeof actionUUID !== "string") return "";
  const parts = actionUUID.split(".");
  return parts[parts.length - 1] ?? "";
}

/**
 * Gates a boolean value based on allow-list membership.
 * @param {Set<string>} allowSet - The set of allowed short names.
 * @param {string} shortName - The action short name.
 * @param {boolean|null|undefined} value - The boolean value to gate.
 * @returns {boolean|null} `value ?? false` if allowed, else `null`.
 */
export function gateBool(allowSet, shortName, value) {
  if (allowSet.has(shortName)) {
    return value ?? false;
  }
  return null;
}

/**
 * Coerces a volume increment value, preserving numeric identity.
 * @param {any} value - The input value.
 * @returns {number|null} `null` for null/empty string; otherwise the numeric value.
 */
export function coerceIncrement(value) {
  if (value == null || value === "") {
    return null;
  }
  return Number(value);
}

/**
 * Encodes UTF-8 text as base64 for favorite metadata.
 * @param {string} text - The raw DIDL-Lite XML string.
 * @returns {string} Base64-encoded string, or original on failure.
 */
export function encodeFavoriteMetadata(text) {
  if (typeof text !== "string") {
    return text;
  }
  try {
    return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  } catch {
    return text;
  }
}

/**
 * Decodes base64 to UTF-8 for favorite metadata.
 * @param {string} value - The base64-encoded string.
 * @returns {string} Decoded UTF-8 XML, or original on failure.
 */
export function decodeFavoriteMetadata(value) {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0)));
  } catch {
    return value;
  }
}

/**
 * Decodes a favorite object's metadata field.
 * @param {object|null|undefined} favorite - The favorite object.
 * @returns {object|null} Decoded favorite object, or null for falsy input.
 */
export function decodeFavorite(favorite) {
  if (!favorite) {
    return null;
  }
  return {
    title: favorite.title,
    uri: favorite.uri,
    metadata: decodeFavoriteMetadata(favorite.metadata),
    albumArtURI: favorite.albumArtURI,
  };
}

function favoriteToggle(shortName, key, merged) {
  if (shortName !== FAVORITE_SHORT_NAME) return null;
  const value = merged[key];
  return typeof value === "boolean" ? value : FAVORITE_TOGGLE_DEFAULTS[key];
}

/**
 * Builds a complete 23-field action settings payload.
 * @param {object} params - Parameters object.
 * @param {string} params.action - Full action UUID.
 * @param {array} params.states - States list snapshot.
 * @param {string} params.controller - Controller type.
 * @param {object} params.current - Current settings (read-site defaults).
 * @param {object} params.overrides - Changed values.
 * @returns {object} Complete settings payload.
 */
export function buildActionSettingsPayload({ action, states, controller, current = {}, overrides = {} }) {
  const merged = { ...current, ...overrides };
  const shortName = actionShortName(action);

  return {
    action: action,
    states: Array.isArray(states) ? [...states] : [],
    controller: controller ?? "Keypad",
    uuid: merged.uuid ?? null,
    title: merged.title ?? null,
    hostAddress: merged.hostAddress ?? null,
    zoneName: merged.zoneName ?? null,
    selectedPlayModes: PLAY_MODE_ACTIONS.has(shortName) ? (merged.selectedPlayModes ?? [...PLAY_MODES]) : null,
    selectedInputSources: shortName === "toggle-input-source" ? (merged.selectedInputSources ?? [...INPUT_SOURCES]) : null,
    encoderAudioEqualizerTarget:
      shortName === "encoder-audio-equalizer" ? (merged.encoderAudioEqualizerTarget ?? "VOLUME") : null,
    encoderPushAction:
      shortName === "encoder-audio-equalizer"
        ? ENCODER_PUSH_ACTIONS.includes(merged.encoderPushAction)
          ? merged.encoderPushAction
          : "NONE"
        : null,
    displayStateBasedTitle: gateBool(STATE_BASED_TITLE_ACTIONS, shortName, merged.displayStateBasedTitle),
    displayAlbumArt: gateBool(ALBUM_ART_ACTIONS, shortName, merged.displayAlbumArt),
    displayMarqueeTitle: gateBool(MARQUEE_TITLE_ACTIONS, shortName, merged.displayMarqueeTitle),
    displayMarqueeAlbumTitle: gateBool(MARQUEE_ALBUM_TITLE_ACTIONS, shortName, merged.displayMarqueeAlbumTitle),
    selectedSonosFavorite: shortName === "play-sonos-favorite" ? decodeFavorite(merged.selectedSonosFavorite) : null,
    displayFavoriteName: favoriteToggle(shortName, "displayFavoriteName", merged),
    displayTrackTitle: favoriteToggle(shortName, "displayTrackTitle", merged),
    displayMarquee: favoriteToggle(shortName, "displayMarquee", merged),
    displayFavoriteArtwork: favoriteToggle(shortName, "displayFavoriteArtwork", merged),
    displayTrackArtwork: favoriteToggle(shortName, "displayTrackArtwork", merged),
    // Written by the plugin when this key's favorite loads the queue; carried through PI saves.
    favoriteSignature: shortName === FAVORITE_SHORT_NAME ? (merged.favoriteSignature ?? null) : null,
    adjustVolumeIncrement:
      shortName === "volume-up" || shortName === "volume-down" ? coerceIncrement(merged.adjustVolumeIncrement) : null,
  };
}
