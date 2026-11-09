/**
 * Play Sonos Favorite: settings shape, one-time migration and the queue-signature model (sonos-gw5).
 * Shared by the PI (toggles) and the plugin (rendering). Pure.
 */

export const FAVORITE_SHORT_NAME = "play-sonos-favorite";

/** Toggle keys for the favorite action, with defaults for a freshly configured key. */
export const FAVORITE_TOGGLE_DEFAULTS = Object.freeze({
  displayFavoriteName: true,
  displayTrackTitle: false,
  displayMarquee: false,
  displayFavoriteArtwork: true,
  displayTrackArtwork: false,
});

export const FAVORITE_TOGGLE_KEYS = Object.freeze(Object.keys(FAVORITE_TOGGLE_DEFAULTS));

/**
 * True when the key's settings predate the five favorite toggles (they only have the legacy
 * displayAlbumArt / displayMarqueeTitle switches).
 */
export function needsFavoriteMigration(settings) {
  return FAVORITE_TOGGLE_KEYS.every((key) => settings?.[key] === undefined || settings?.[key] === null);
}

/**
 * Maps legacy toggles onto the new ones (agreed 2026-11-08):
 *   displayAlbumArt     -> displayFavoriteArtwork + displayTrackArtwork
 *   displayMarqueeTitle -> displayTrackTitle + displayMarquee
 *   displayFavoriteName -> true
 * Returns a new object; legacy keys are dropped. Settings that already use the new toggles are
 * returned unchanged (same object).
 */
export function migrateFavoriteSettings(settings) {
  if (!needsFavoriteMigration(settings)) return settings;
  const hasLegacy = settings?.displayAlbumArt != null || settings?.displayMarqueeTitle != null;
  const art = hasLegacy ? settings.displayAlbumArt === true : FAVORITE_TOGGLE_DEFAULTS.displayFavoriteArtwork;
  const marquee = settings?.displayMarqueeTitle === true;
  const rest = { ...(settings ?? {}) };
  delete rest.displayAlbumArt;
  delete rest.displayMarqueeTitle;
  return {
    ...rest,
    displayFavoriteName: true,
    displayTrackTitle: marquee,
    displayMarquee: marquee,
    displayFavoriteArtwork: art,
    displayTrackArtwork: hasLegacy ? art : FAVORITE_TOGGLE_DEFAULTS.displayTrackArtwork,
  };
}

/** Radio favorites are played directly; everything else is loaded into the queue. */
export function isQueueFavorite(favorite) {
  return !!favorite?.uri && !favorite.uri.startsWith("x-sonosapi-stream:");
}

/** Queue signatures match when the queue version, size and first track all match. */
export function signaturesEqual(a, b) {
  return (
    !!a &&
    !!b &&
    String(a.updateId) === String(b.updateId) &&
    Number(a.total) === Number(b.total) &&
    (a.firstTrackUri ?? "") === (b.firstTrackUri ?? "")
  );
}

/**
 * Is this favorite key the one whose favorite the speaker is currently on?
 * Playing, paused and stopped all count (agreed: stopped behaves like paused).
 * @param {Object} settings - key settings (selectedSonosFavorite, favoriteSignature)
 * @param {Object} state - speaker state (mediaURI, queueSignature)
 */
export function isFavoriteActive(settings, state) {
  const favorite = settings?.selectedSonosFavorite;
  if (!favorite?.uri || !state) return false;
  if (!isQueueFavorite(favorite)) {
    return (state.mediaURI ?? state.currentURI) === favorite.uri;
  }
  if (!String(state.mediaURI ?? "").startsWith("x-rincon-queue:")) return false;
  return signaturesEqual(settings.favoriteSignature, state.queueSignature);
}

/** One-line truncation used for the favorite name (agreed: always truncate, never scroll). */
export function truncateLine(text, width) {
  const t = String(text ?? "");
  return t.length <= width ? t : `${t.slice(0, Math.max(1, width - 1))}…`;
}
