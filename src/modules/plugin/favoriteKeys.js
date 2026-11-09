import {
  FAVORITE_SHORT_NAME,
  isFavoriteActive,
  isQueueFavorite,
  signaturesEqual,
  truncateLine,
} from "../common/favoriteSettings.js";
import { MARQUEE_WIDTH, computeMarqueeWindow, albumArtImage } from "./marquee.js";
import { actionSettings, setActionSettings } from "./actionSettings.js";
import { getAllSpeakers } from "./SonosSpeakers.js";

// Name on the first line, track title pushed towards the bottom of the key (manifest aligns titles top).
const TRACK_LINE_GAP = "\n\n\n";
const RUNTIME_KEYS = ["status", "currentStateIndex", "marqueePositionBottom", "lastFavoriteTrackTitle"];

export function isFavoriteSettings(settings) {
  return settings?.action?.split(".").pop() === FAVORITE_SHORT_NAME;
}

/**
 * Render intent for a Play Sonos Favorite key (sonos-gw5).
 * Active key: favorite name (top, truncated), track title (bottom, optional marquee), track art.
 * Inactive key: favorite name only, favorite artwork. Never shows another favorite's track or art.
 */
export function buildFavoriteRenderIntent({ inActionSettings, inSonosSpeakerState }) {
  const settings = inActionSettings ?? {};
  const state = inSonosSpeakerState ?? {};
  const favorite = settings.selectedSonosFavorite ?? {};
  const active = isFavoriteActive(settings, state);

  const nameLine = settings.displayFavoriteName ? truncateLine(favorite.title, MARQUEE_WIDTH) : "";

  let trackLine = "";
  if (active && settings.displayTrackTitle) {
    const track = state.playing?.title ?? "";
    if (track !== settings.lastFavoriteTrackTitle) {
      settings.marqueePositionBottom = 0;
      settings.lastFavoriteTrackTitle = track;
    }
    if (settings.displayMarquee) {
      const { window, nextPos } = computeMarqueeWindow(track, settings.marqueePositionBottom ?? 0, MARQUEE_WIDTH);
      trackLine = window;
      settings.marqueePositionBottom = nextPos;
    } else {
      trackLine = truncateLine(track, MARQUEE_WIDTH);
    }
  }

  let title = null;
  if (nameLine || trackLine) {
    title = trackLine ? `${nameLine}${TRACK_LINE_GAP}${trackLine}` : nameLine;
  }

  let artURI = null;
  if (active && settings.displayTrackArtwork && state.playing?.albumArtURI) {
    artURI = state.playing.albumArtURI;
  } else if (settings.displayFavoriteArtwork && favorite.albumArtURI) {
    artURI = favorite.albumArtURI;
  }
  // While art is downloading, leave the key's image alone (undefined = no setImage); the ticker
  // redraws when the download lands. null resets to the default image.
  const imageDataURL = artURI ? albumArtImage(artURI) : null;

  return { imageDataURL, title, titleSource: null };
}

/** True when this key's track title is long enough to scroll right now (marquee ticker filter). */
export function favoriteWantsMarquee(settings, state) {
  return (
    !!settings?.displayTrackTitle &&
    !!settings?.displayMarquee &&
    isFavoriteActive(settings, state) &&
    String(state?.playing?.title ?? "").length > MARQUEE_WIDTH
  );
}

export function persistable(settings) {
  const out = { ...settings };
  for (const key of RUNTIME_KEYS) delete out[key];
  return out;
}

/**
 * Propagates the current queue signature to every favorite key on the speaker that holds the
 * favorite which loaded it (identical keys count as one, agreed Q3), and persists it in each key's
 * settings so the active key survives restarts (agreed Q1).
 *
 * The owning favorite is the one recorded at keyDown (state.loadedFavorite) or, after a restart,
 * any key on the speaker whose persisted signature already matches the queue.
 * @returns {string[]} contexts whose settings were written
 */
export function syncFavoriteKeys({ UUID, sd }) {
  const speaker = getAllSpeakers()[UUID];
  const current = speaker?.state?.queueSignature;
  if (!speaker || !current || !String(speaker.state.mediaURI ?? "").startsWith("x-rincon-queue:")) return [];

  const favoriteContexts = speaker.contexts.filter((c) => isFavoriteSettings(actionSettings[c]));
  if (favoriteContexts.length === 0) return [];

  let ownerUri = null;
  const loaded = speaker.state.loadedFavorite;
  if (loaded?.uri && signaturesEqual(loaded.signature, current)) {
    ownerUri = loaded.uri;
  } else if (loaded?.uri && loaded.signature?.firstTrackUri && loaded.signature.firstTrackUri === current.firstTrackUri) {
    // Same queue, still filling (or edited) since keyDown read it: Sonos keeps appending a large
    // playlist after AddURIToQueue returns, which bumps UpdateID/TotalMatches (sonos-dl6). Adopt the
    // newer signature so the key stays active and survives a restart.
    loaded.signature = { ...current };
    ownerUri = loaded.uri;
  } else {
    const owner = favoriteContexts.map((c) => actionSettings[c]).find((s) => signaturesEqual(s.favoriteSignature, current));
    ownerUri = owner?.selectedSonosFavorite?.uri ?? null;
  }
  if (!ownerUri) return [];

  const written = [];
  for (const context of favoriteContexts) {
    const settings = actionSettings[context];
    const favorite = settings.selectedSonosFavorite;
    if (favorite?.uri !== ownerUri || !isQueueFavorite(favorite)) continue;
    if (signaturesEqual(settings.favoriteSignature, current)) continue;
    const next = { ...settings, favoriteSignature: { speakerUuid: UUID, ...current } };
    setActionSettings(context, next);
    sd?.saveSettings?.({ actionSettings: persistable(next), context });
    written.push(context);
  }
  return written;
}

/** Whether a speaker has any favorite keys on screen (only then does polling read queue info). */
export function speakerHasFavoriteKeys(UUID) {
  const speaker = getAllSpeakers()[UUID];
  return !!speaker?.contexts?.some((c) => isFavoriteSettings(actionSettings[c]));
}
