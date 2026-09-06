export const MARQUEE_WIDTH = 10;

const albumArtCache = new Map();
const inFlightFetches = new Map();

function _resetAlbumArtCache() {
  albumArtCache.clear();
  inFlightFetches.clear();
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

  fetch(url)
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
    })
    .catch(() => {
      // Swallow errors, cache nothing
    })
    .finally(() => {
      inFlightFetches.delete(url);
    });

  return null;
}

function buildMarqueeRenderIntent({ inActionSettings, inSonosSpeakerState }) {
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

  const imageDataURL = settings.displayAlbumArt ? ensureAlbumArtCached(currentAlbumArtURI) : null;

  const lines = [];
  const sources = [];

  const displayMarqueeTitle = settings.displayMarqueeTitle ?? false;
  const displayMarqueeAlbumTitle = settings.displayMarqueeAlbumTitle ?? false;

  if (displayMarqueeTitle) {
    const title = playing.title ?? "";
    const pos = settings.marqueePositionTop ?? 0;
    const { window, nextPos } = computeMarqueeWindow(title, pos, MARQUEE_WIDTH);
    lines.push(window);
    sources.push(title);
    settings.marqueePositionTop = nextPos;
  }

  if (displayMarqueeAlbumTitle) {
    const album = playing.album ?? "";
    const pos = settings.marqueePositionBottom ?? 0;
    const { window, nextPos } = computeMarqueeWindow(album, pos, MARQUEE_WIDTH);
    lines.push(window);
    sources.push(album);
    settings.marqueePositionBottom = nextPos;
  }

  const title = lines.length > 0 ? lines.join("\n") : null;
  const titleSource = sources.length > 0 ? sources.join("\n") : null;

  return { imageDataURL, title, titleSource };
}

export {
  detectInputSource,
  computeMarqueeWindow,
  ensureAlbumArtCached,
  buildMarqueeRenderIntent,
  _resetAlbumArtCache,
  _getAlbumArtCache,
};
