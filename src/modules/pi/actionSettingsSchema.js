/**
 * Pure builder for the per-context action-settings persistence payload
 * written by `PiComponent.saveSettings()`.
 *
 * Owns two regression guards specified in orw.11:
 *
 *   1. PR #4 numeric round-trip — adjustVolumeIncrement persists with `??`
 *      semantics, NOT `||`, so the value 1 is not falsy-coerced. Empty string
 *      and nullish input persist as `null` (inherit global default).
 *
 *   2. Base64 metadata round-trip — selectedSonosFavorite.metadata is
 *      base64-decoded back to UTF-8 before persisting. The encoded form lives
 *      only in the dropdown option attribute (to avoid HTML attribute
 *      encoding issues), never in the persisted JSON.
 *
 * Per-action gating:
 *   - The four display toggles (StateBasedTitle, MarqueeTitle,
 *     MarqueeAlbumTitle, AlbumArt) persist as boolean (default false) when
 *     the action is in their allow-list, else `null`.
 *   - selectedPlayModes / selectedInputSources / encoderAudioEqualizerTarget /
 *     selectedSonosFavorite / adjustVolumeIncrement persist with their
 *     action-specific defaults when applicable, else `null`.
 *
 * Schema reference: data-model.md §Shape:ActionSettings,
 * frontend.md §"Per-action settings".
 */

const ACTION_PREFIX = "com.r-teller.sonoscontroller.";

export const PLAY_MODE_DEFAULTS = Object.freeze([
  "NORMAL",
  "SHUFFLE_NOREPEAT",
  "SHUFFLE_REPEAT_ONE",
  "SHUFFLE",
  "REPEAT_ONE",
  "REPEAT_ALL",
]);

export const INPUT_SOURCE_DEFAULTS = Object.freeze([
  "Sonos_Queue",
  "TV_Input",
  "Line_In",
]);

export const DISPLAY_STATE_TITLE_ACTIONS = Object.freeze(
  new Set([
    "toggle-play-mode",
    "toggle-input-source",
    "toggle-play-pause",
    "toggle-mute-unmute",
    "volume-up",
    "volume-down",
    "play-previous-track",
    "play-next-track",
  ]),
);

export const DISPLAY_MARQUEE_TITLE_ACTIONS = Object.freeze(
  new Set(["play-sonos-favorite", "currently-playing"]),
);

export const DISPLAY_MARQUEE_ALBUM_TITLE_ACTIONS = Object.freeze(
  new Set(["toggle-play-pause", "currently-playing"]),
);

export const DISPLAY_ALBUM_ART_ACTIONS = Object.freeze(
  new Set(["toggle-play-pause", "play-sonos-favorite", "currently-playing"]),
);

/**
 * Extract the short action name from a full UUID. Returns the input verbatim
 * if it doesn't start with the action prefix (defensive — the SDK gives full
 * UUIDs in production but tests may pass short names directly).
 */
export function actionShortName(actionUUID) {
  if (typeof actionUUID !== "string") return "";
  return actionUUID.startsWith(ACTION_PREFIX)
    ? actionUUID.slice(ACTION_PREFIX.length)
    : actionUUID;
}

export function buildActionSettingsPayload(input) {
  const {
    action,
    states = [],
    controller,
    uuid,
    title,
    hostAddress,
    zoneName,
    selectedPlayModes,
    selectedInputSources,
    encoderAudioEqualizerTarget,
    displayStateBasedTitle,
    displayAlbumArt,
    displayMarqueeTitle,
    displayMarqueeAlbumTitle,
    selectedSonosFavorite,
    adjustVolumeIncrement,
  } = input;

  const sn = actionShortName(action);

  return {
    action,
    states,
    controller,
    uuid,
    title,
    hostAddress,
    zoneName,

    selectedPlayModes:
      sn === "toggle-play-mode"
        ? (selectedPlayModes ?? [...PLAY_MODE_DEFAULTS])
        : null,
    selectedInputSources:
      sn === "toggle-input-source"
        ? (selectedInputSources ?? [...INPUT_SOURCE_DEFAULTS])
        : null,
    encoderAudioEqualizerTarget:
      sn === "encoder-audio-equalizer"
        ? (encoderAudioEqualizerTarget ?? "VOLUME")
        : null,

    displayStateBasedTitle: gateBool(
      sn,
      DISPLAY_STATE_TITLE_ACTIONS,
      displayStateBasedTitle,
    ),
    displayAlbumArt: gateBool(sn, DISPLAY_ALBUM_ART_ACTIONS, displayAlbumArt),
    displayMarqueeTitle: gateBool(
      sn,
      DISPLAY_MARQUEE_TITLE_ACTIONS,
      displayMarqueeTitle,
    ),
    displayMarqueeAlbumTitle: gateBool(
      sn,
      DISPLAY_MARQUEE_ALBUM_TITLE_ACTIONS,
      displayMarqueeAlbumTitle,
    ),

    selectedSonosFavorite:
      sn === "play-sonos-favorite"
        ? decodeFavorite(selectedSonosFavorite)
        : null,

    adjustVolumeIncrement:
      sn === "volume-up" || sn === "volume-down"
        ? coerceIncrement(adjustVolumeIncrement)
        : null,
  };
}

function gateBool(shortName, allowList, value) {
  if (!allowList.has(shortName)) return null;
  return value ?? false;
}

/**
 * Persist `null` for nullish/empty input; otherwise the value verbatim.
 * Critically uses `??`-style semantics, not `||` — preserves the value 1
 * (and 0). PR #4 regression guard.
 */
function coerceIncrement(value) {
  if (value == null || value === "") return null;
  return value;
}

function decodeFavorite(fav) {
  if (!fav) return null;
  return {
    title: fav.title,
    uri: fav.uri,
    metadata: decodeBase64Metadata(fav.metadata),
    albumArtURI: fav.albumArtURI,
  };
}

/**
 * Decode a base64 string back to UTF-8. The dropdown option attribute holds
 * favorite metadata as base64 to dodge HTML attribute encoding issues; the
 * persisted JSON must contain the original UTF-8 XML.
 *
 * Defensive on input shape: non-strings pass through unchanged. If decoding
 * throws (malformed base64, non-base64 input), returns the original string —
 * the alternative is dropping legitimate metadata on a bad guess.
 */
export function decodeBase64Metadata(raw) {
  if (typeof raw !== "string") return raw;
  if (raw === "") return raw;
  try {
    const bin = atob(raw);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return raw;
  }
}

/**
 * Encode a UTF-8 string to base64. Mirror of decodeBase64Metadata; exposed
 * so the dropdown population path can encode metadata symmetrically.
 */
export function encodeBase64Metadata(utf8) {
  if (typeof utf8 !== "string") return utf8;
  const bytes = new TextEncoder().encode(utf8);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
