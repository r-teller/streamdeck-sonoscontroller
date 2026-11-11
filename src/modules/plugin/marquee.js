import { trackTimeView, wantsTrackTime } from "./trackTime.js";
import { composeKeyImage } from "./keyImage.js";

// Characters that fit across a key in Stream Deck's bold title font. Wider text is centered and
// cropped on both edges ("endrick ." for "Kendrick …"), so names are cut and marquees scroll at 8.
export const MARQUEE_WIDTH = 8;

const albumArtCache = new Map();
const inFlightFetches = new Map();
// url -> epoch ms of the last failed download; retried after ART_RETRY_MS
const failedFetches = new Map();
const ART_FETCH_TIMEOUT_MS = 10_000;
const ART_RETRY_MS = 60_000;
const artCachedListeners = new Set();

/**
 * Registers a callback fired after an album-art image finishes downloading, so keys that rendered
 * the default image while it was in flight can redraw. Returns an unsubscribe function.
 */
function onAlbumArtCached(callback) {
  artCachedListeners.add(callback);
  return () => artCachedListeners.delete(callback);
}

function _resetAlbumArtCache() {
  albumArtCache.clear();
  inFlightFetches.clear();
  failedFetches.clear();
}

function _getAlbumArtCache() {
  return albumArtCache;
}

function detectInputSource(uri) {
  if (!uri || typeof uri !== "string") return "QUEUE";

  if (uri.startsWith("x-sonos-htastream:") && uri.includes(":spdif")) {
    return "TV";
  }

  if (uri.startsWith("x-rincon-stream:")) {
    return "LINE_IN";
  }

  return "QUEUE";
}

function computeMarqueeWindow(text, pos, width) {
  if (!text || typeof text !== "string" || text.length === 0) {
    return { window: "", nextPos: 0 };
  }

  if (text.length <= width) {
    return { window: text, nextPos: 0 };
  }

  const gap = "    ";
  const looped = text + gap + text.slice(0, width);
  const wrapLength = text.length + gap.length;

  let p = pos % wrapLength;
  if (p < 0) p += wrapLength;

  const window = looped.slice(p, p + width);
  const nextPos = (p + 1) % wrapLength;

  return { window, nextPos };
}

function ensureAlbumArtCached(url) {
  if (!url || typeof url !== "string") return null;

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return url;
  }

  if (albumArtCache.has(url)) {
    return albumArtCache.get(url);
  }

  if (inFlightFetches.has(url)) {
    return null;
  }

  inFlightFetches.set(url, true);

  // A hung download must not pin the URL in inFlightFetches forever (sonos-p93).
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), ART_FETCH_TIMEOUT_MS) : null;

  fetch(url, controller ? { signal: controller.signal } : undefined)
    .then(async (response) => {
      if (!response.ok) throw new Error("Fetch failed");
      const contentType = response.headers.get("content-type") || "";
      const arrayBuffer = await response.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      const dataURL = `data:${contentType};base64,${base64}`;
      albumArtCache.set(url, dataURL);
      failedFetches.delete(url);
      for (const listener of artCachedListeners) {
        try {
          listener(url);
        } catch (e) {
          // a failing listener must not break the cache
        }
      }
    })
    .catch(() => {
      // Swallow errors, cache nothing; remember the failure so renders fall back to the default image.
      failedFetches.set(url, Date.now());
      for (const listener of artCachedListeners) {
        try {
          listener(url);
        } catch (e) {
          // ignore
        }
      }
    })
    .finally(() => {
      if (timer) clearTimeout(timer);
      inFlightFetches.delete(url);
    });

  return null;
}

/**
 * Image for a key showing this art URL, distinguishing "still downloading" from "nothing to show":
 *   data URL / local path -> show it
 *   undefined             -> download in flight: leave the key's current image alone (no setImage)
 *   null                  -> no art, or the download failed recently: reset to the default image
 * Passing null while downloading made every track change flash the manifest icon (sonos-p93).
 */
function albumArtImage(url) {
  if (!url || typeof url !== "string") return null;
  const failedAt = failedFetches.get(url);
  if (failedAt !== undefined && !albumArtCache.has(url)) {
    if (Date.now() - failedAt < ART_RETRY_MS) return null;
    failedFetches.delete(url);
  }
  return ensureAlbumArtCached(url) ?? undefined;
}

function buildMarqueeRenderIntent({ inActionSettings, inSonosSpeakerState, advanceMarquee = false }) {
  const state = inSonosSpeakerState ?? {};
  const playing = state.playing ?? {};
  const source = detectInputSource(state.currentURI);

  if (source === "TV") {
    return {
      imageDataURL: "./images/keys/input_tv.png",
      title: inActionSettings.displayStateBasedTitle ? "TV" : null,
      titleSource: "TV",
    };
  }

  if (source === "LINE_IN") {
    return {
      imageDataURL: "./images/keys/input_line_in.png",
      title: inActionSettings.displayStateBasedTitle ? "Line In" : null,
      titleSource: "Line In",
    };
  }

  // QUEUE branch
  const settings = inActionSettings ?? {};
  const lastTrackArtURI = settings.lastTrackArtURI;
  const currentAlbumArtURI = playing.albumArtURI;

  if (lastTrackArtURI !== currentAlbumArtURI) {
    settings.marqueePositionTop = 0;
    settings.marqueePositionBottom = 0;
    settings.lastTrackArtURI = currentAlbumArtURI;
  }

  const artImage = settings.displayAlbumArt ? albumArtImage(currentAlbumArtURI) : null;
  // Track time (sonos-bg0.2): remaining time + bar drawn over the art, only when art is shown.
  const hasArt = typeof artImage === "string" && artImage !== "";
  const time = hasArt && wantsTrackTime(settings) ? trackTimeView(state) : null;
  // Heart badge (sonos-bg0.3) when the song is in the Stream Deck Favorites playlist.
  const badge = hasArt && settings.displayFavoriteBadge !== false && state.inFavorites === true;
  const imageDataURL = time || badge ? composeKeyImage(artImage, { ...time, badge }) : artImage;

  const sources = [];
  let titleLine = "";
  let albumLine = "";

  if (settings.displayMarqueeTitle ?? false) {
    const title = playing.title ?? "";
    titleLine = marqueeLine(settings, "marqueePositionTop", title, advanceMarquee);
    sources.push(title);
  }

  if (settings.displayMarqueeAlbumTitle ?? false) {
    const album = playing.album ?? "";
    albumLine = marqueeLine(settings, "marqueePositionBottom", album, advanceMarquee);
    sources.push(album);
  }

  // Track title on the top row, album on the bottom row (sonos-9at): joined with a single newline
  // the two windows sat directly on top of each other and read as one crowded line.
  // The time sits at the bottom of the key, so the album moves up to the second row.
  const title = time
    ? composeKeyTitle({ top: titleLine, middle: albumLine })
    : composeKeyTitle({ top: titleLine, bottom: albumLine });
  const titleSource = sources.length > 0 ? sources.join("\n") : null;

  return { imageDataURL, title, titleSource, titleLine, albumLine, timeShown: !!time };
}

/**
 * Current marquee window for one line. The position only moves when the render ticker asks
 * (advanceMarquee); a redraw triggered by a poll, an action or a settings change shows the same
 * frame, otherwise every poll made the text jump an extra character (sonos-9at).
 */
function marqueeLine(settings, positionKey, text, advanceMarquee) {
  let pos = settings[positionKey] ?? 0;
  if (advanceMarquee) {
    pos = computeMarqueeWindow(text, pos, MARQUEE_WIDTH).nextPos;
    settings[positionKey] = pos;
  }
  return computeMarqueeWindow(text, pos, MARQUEE_WIDTH).window;
}

/**
 * Lays out up to three lines on a key whose title is top-aligned: top row, the row under it, and
 * the bottom row (pushed down with blank lines). Returns null when there is nothing to show.
 */
function composeKeyTitle({ top = "", middle = "", bottom = "" }) {
  if (!top && !middle && !bottom) return null;
  if (!bottom) return middle ? `${top}\n${middle}` : top;
  if (middle) return `${top}\n${middle}\n\n${bottom}`;
  return `${top}\n\n\n${bottom}`;
}

export {
  detectInputSource,
  computeMarqueeWindow,
  ensureAlbumArtCached,
  albumArtImage,
  onAlbumArtCached,
  buildMarqueeRenderIntent,
  composeKeyTitle,
  _resetAlbumArtCache,
  _getAlbumArtCache,
};
