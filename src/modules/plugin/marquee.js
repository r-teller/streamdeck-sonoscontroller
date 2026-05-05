/**
 * Marquee + album-art helper.
 *
 * `buildMarqueeRenderIntent({inActionSettings, inSonosSpeakerState})` returns
 * a render-intent object consumed by the action state functions registered
 * in `actionFunctionMap[*].state` (etr.4 registry). Phase 5 action handlers
 * delegate the marquee/album-art slice of rendering to this module.
 *
 * - Source detection: `currentURI` prefix → TV / Line-In / Queue branches.
 * - Album-art fetch: remote http(s) URIs are fetched once, base64-encoded,
 *   and cached. Local file paths pass through unchanged. The synchronous
 *   render path returns the previously cached data URL (or null on miss);
 *   an out-of-band fetch warms the cache for the next poll cycle.
 * - Marquee scroll: one character per render cycle, signed scroll position
 *   tracked per-context on `inActionSettings.marqueePosition{Top,Bottom}`.
 *   Position resets to 0 when `playing.albumArtURI` changes.
 *
 * Output shape (consumed by etr.7's renderDedupe):
 *   { imageDataURL, title, titleSource }
 *
 * See prd-what.md §5.1, §7.2, §8.2 and backend.md "Render dedupe".
 */

export const MARQUEE_WIDTH = 10;

// Module-level cache. Keyed by remote URL — the value is the base64 data URL.
const albumArtCache = {};
const albumArtFetchInFlight = {};

async function defaultFetcher(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`album art HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const b64 = (typeof btoa === "function" ? btoa : (s) => Buffer.from(s, "binary").toString("base64"))(binary);
  const mime = res.headers.get("content-type") || "image/jpeg";
  return `data:${mime};base64,${b64}`;
}

/**
 * Out-of-band: kick off a fetch if one isn't already in flight. Cache hit
 * returns immediately. Errors are swallowed — the render cycle remains
 * stable.
 */
export async function ensureAlbumArtCached(url, fetcher = defaultFetcher) {
  if (!url) return null;
  if (albumArtCache[url]) return albumArtCache[url];
  if (albumArtFetchInFlight[url]) return null;
  albumArtFetchInFlight[url] = true;
  try {
    const dataURL = await fetcher(url);
    albumArtCache[url] = dataURL;
    return dataURL;
  } catch (_err) {
    return null;
  } finally {
    delete albumArtFetchInFlight[url];
  }
}

/** Test-only: reset the cache between cases. */
export function _resetAlbumArtCache() {
  for (const k of Object.keys(albumArtCache)) delete albumArtCache[k];
  for (const k of Object.keys(albumArtFetchInFlight)) delete albumArtFetchInFlight[k];
}

/** Test-only: peek the cache. */
export function _getAlbumArtCache() {
  return albumArtCache;
}

/**
 * Compute one marquee window. If text fits within `width`, return it
 * unscrolled; otherwise advance the scroll position by 1.
 *
 * Uses a 4-char padding gap on wrap so the loop reads cleanly.
 */
export function computeMarqueeWindow(text, position, width) {
  if (!text) return { window: "", nextPos: 0 };
  if (text.length <= width) {
    return { window: text, nextPos: 0 };
  }
  const gap = "    "; // 4-char breathing room between loops
  const padded = text + gap + text.slice(0, width);
  const wrapAt = text.length + gap.length;
  let pos = position;
  if (pos < 0 || pos >= wrapAt) pos = 0;
  return { window: padded.slice(pos, pos + width), nextPos: pos + 1 };
}

function detectInputSource(currentURI) {
  const uri = String(currentURI || "");
  if (uri.startsWith("x-sonos-htastream") && uri.endsWith(":spdif")) {
    return "TV";
  }
  if (uri.startsWith("x-rincon-stream")) {
    return "LINE_IN";
  }
  return "QUEUE";
}

/**
 * Build the marquee/album-art slice of a render-intent. Mutates
 * `inActionSettings.marqueePosition{Top,Bottom}` and
 * `inActionSettings.lastTrackArtURI` (used to detect track changes).
 *
 * @param {object} args
 * @param {object} args.inActionSettings — Per-context settings (mutated).
 * @param {object} args.inSonosSpeakerState — Speaker state from the store.
 * @param {Function} [args.fetcher] — Album art fetcher; defaults to native fetch.
 * @param {number} [args.marqueeWidth] — Override the default window width.
 *
 * @returns {{imageDataURL: string|null, title: string|null, titleSource: string|null}}
 */
export function buildMarqueeRenderIntent({
  inActionSettings,
  inSonosSpeakerState,
  fetcher = defaultFetcher,
  marqueeWidth = MARQUEE_WIDTH,
} = {}) {
  const settings = inActionSettings || {};
  const speakerState = inSonosSpeakerState || {};
  const playing = speakerState.playing || {};
  const source = detectInputSource(speakerState.currentURI);

  if (source === "TV") {
    return {
      imageDataURL: "./images/keys/input_tv.png",
      title: settings.displayStateBasedTitle ? "TV" : null,
      titleSource: "TV",
    };
  }
  if (source === "LINE_IN") {
    return {
      imageDataURL: "./images/keys/input_line_in.png",
      title: settings.displayStateBasedTitle ? "Line In" : null,
      titleSource: "Line In",
    };
  }

  // Queue branch — album art + marquee.
  if (settings.lastTrackArtURI !== playing.albumArtURI) {
    settings.marqueePositionTop = 0;
    settings.marqueePositionBottom = 0;
    settings.lastTrackArtURI = playing.albumArtURI;
  }

  let imageDataURL = null;
  if (settings.displayAlbumArt && playing.albumArtURI) {
    if (/^https?:\/\//i.test(playing.albumArtURI)) {
      if (albumArtCache[playing.albumArtURI]) {
        imageDataURL = albumArtCache[playing.albumArtURI];
      } else {
        // Out-of-band fetch warms the cache for the next render cycle.
        // Promise is intentionally unawaited.
        ensureAlbumArtCached(playing.albumArtURI, fetcher);
      }
    } else {
      // Local file:// or ./images/... path — pass through unchanged.
      imageDataURL = playing.albumArtURI;
    }
  }

  let titleParts = [];
  let titleSourceParts = [];

  if (settings.displayMarqueeTitle && playing.title) {
    const win = computeMarqueeWindow(
      playing.title,
      settings.marqueePositionTop ?? 0,
      marqueeWidth,
    );
    settings.marqueePositionTop = win.nextPos;
    titleParts.push(win.window);
    titleSourceParts.push(playing.title);
  }

  if (settings.displayMarqueeAlbumTitle && playing.album) {
    const win = computeMarqueeWindow(
      playing.album,
      settings.marqueePositionBottom ?? 0,
      marqueeWidth,
    );
    settings.marqueePositionBottom = win.nextPos;
    titleParts.push(win.window);
    titleSourceParts.push(playing.album);
  }

  const title = titleParts.length > 0 ? titleParts.join("\n") : null;
  const titleSource = titleSourceParts.length > 0 ? titleSourceParts.join("\n") : null;

  return { imageDataURL, title, titleSource };
}
