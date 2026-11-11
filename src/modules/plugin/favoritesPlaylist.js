/**
 * The "Stream Deck Favorites" Sonos playlist (sonos-bg0): which songs are in it, so keys can show a
 * heart and the favorite key can add or remove the playing song.
 *
 * Sonos playlists belong to the household. The poll reads the playlist's change counter (one item,
 * a few ms) and re-reads the songs only when the counter or the length changed; the counter also
 * moves when the playlist is edited in the Sonos app (verified on a real speaker, sonos-bg0.1).
 */
export const PLAYLIST_TITLE = "Stream Deck Favorites";
export const CHUNK = 100;
export const MAX_TRACKS = 1000;
/** How long to wait before looking for a missing playlist again. */
export const SEARCH_RETRY_MS = 30_000;

/**
 * A song's identity for matching: the same Spotify track started from another playlist or album has
 * different query parameters (flags, sn), so only the service and track ID count.
 */
export function trackKey(uri) {
  const text = String(uri ?? "").replace(/&amp;/g, "&");
  if (!text) return "";
  const spotify = text.match(/spotify(?:%3a|:)track(?:%3a|:)([A-Za-z0-9]+)/i);
  if (spotify) return `spotify:track:${spotify[1]}`;
  return text.split("?")[0];
}

/** Spotify is the only service supported for now (user decision 2026-11-10). */
export function canFavorite(uri) {
  return trackKey(uri).startsWith("spotify:track:");
}

const playlists = new Map(); // speaker UUID -> { id, updateId, total, keys: string[], searchedAt }

/** Test hook. */
export function _resetFavoritesPlaylist() {
  playlists.clear();
}

export function playlistEntry(uuid) {
  return playlists.get(uuid) ?? null;
}

/** Positions (0-based) of every copy of this song in the playlist. */
export function positionsOf(uuid, uri) {
  const key = trackKey(uri);
  const entry = playlists.get(uuid);
  if (!key || !entry?.keys) return [];
  return entry.keys.flatMap((k, i) => (k === key ? [i] : []));
}

export function isInPlaylist(uuid, uri) {
  return positionsOf(uuid, uri).length > 0;
}

async function loadTracks(controller, id, total) {
  const keys = [];
  const wanted = Math.min(total, MAX_TRACKS);
  for (let start = 0; start < wanted; start += CHUNK) {
    const page = await controller.getPlaylistTracks(id, { start, count: Math.min(CHUNK, wanted - start) });
    keys.push(...page.uris.map(trackKey));
    if (page.uris.length === 0) break;
  }
  return keys;
}

/**
 * Brings the cached playlist up to date; cheap when nothing changed. Returns the entry, or one with
 * `id: null` when the household has no such playlist. Pass `force` to re-read the songs regardless
 * (the favorite key does this before adding, so it never adds a duplicate).
 */
export async function refreshPlaylist(uuid, controller, { now = Date.now(), force = false } = {}) {
  let entry = playlists.get(uuid) ?? { id: null, updateId: null, total: 0, keys: [], searchedAt: 0 };
  if (!entry.id) {
    if (!force && entry.searchedAt && now - entry.searchedAt < SEARCH_RETRY_MS) return entry;
    const found = await controller.findPlaylist(PLAYLIST_TITLE);
    entry = { id: found?.id ?? null, updateId: null, total: 0, keys: [], searchedAt: now };
    playlists.set(uuid, entry);
    if (!entry.id) return entry;
  }
  let sig;
  try {
    sig = await controller.getPlaylistSignature(entry.id);
  } catch (err) {
    // Deleted in the Sonos app: look for it again next time.
    entry = { id: null, updateId: null, total: 0, keys: [], searchedAt: now };
    playlists.set(uuid, entry);
    return entry;
  }
  if (force || sig.updateId !== entry.updateId || sig.total !== entry.total) {
    const keys = await loadTracks(controller, entry.id, sig.total);
    entry = { ...entry, updateId: sig.updateId, total: sig.total, keys };
    playlists.set(uuid, entry);
  }
  return entry;
}

/** Records a change the favorite key just made, so the heart updates before the next poll. */
export function recordPlaylistChange(uuid, { id, updateId, total, keys }) {
  const entry = playlists.get(uuid) ?? { searchedAt: 0 };
  playlists.set(uuid, { ...entry, id, updateId, total, keys });
}

const xmlEscape = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Metadata for adding a Spotify track to a Sonos playlist so its title, artist and art are kept.
 * Verified on a real speaker (sonos-bg0.1): the speaker needs Spotify's item id form and the account
 * tag (service type = sid * 256 + 7, e.g. 3079 for sid 12); the queue item's own id loses the title,
 * and the queue id together with the tag is refused (error 814).
 */
export function spotifyTrackMetadata({ uri, title, artist, album, albumArtURI }) {
  const plain = String(uri ?? "").replace(/&amp;/g, "&");
  const trackId = plain.match(/spotify(?:%3a|:)track(?:%3a|:)([A-Za-z0-9]+)/i)?.[1];
  const sid = Number(plain.match(/[?&]sid=(\d+)/)?.[1]);
  if (!trackId || !sid) return null;
  const type = sid * 256 + 7;
  // The speaker serves art from its own /getaa path; keep it relative like the Sonos app does.
  const art = String(albumArtURI ?? "").replace(/^https?:\/\/[^/]+(?=\/getaa)/, "");
  return (
    `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" ` +
    `xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/">` +
    `<item id="10032020spotify%3atrack%3a${trackId}" parentID="" restricted="true">` +
    `<res protocolInfo="sonos.com-spotify:*:audio/x-spotify:*">${xmlEscape(plain)}</res>` +
    (art ? `<upnp:albumArtURI>${xmlEscape(art)}</upnp:albumArtURI>` : "") +
    `<dc:title>${xmlEscape(title)}</dc:title><upnp:class>object.item.audioItem.musicTrack</upnp:class>` +
    `<dc:creator>${xmlEscape(artist)}</dc:creator><upnp:album>${xmlEscape(album)}</upnp:album>` +
    `<desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON${type}_X_#Svc${type}-0-Token</desc>` +
    `</item></DIDL-Lite>`
  );
}

const pressChains = new Map(); // speaker UUID -> promise of the press in progress

/** Runs presses one at a time per speaker, so a fast double press is add then remove, never two adds. */
export function oneAtATime(uuid, task) {
  const run = (pressChains.get(uuid) ?? Promise.resolve()).then(task, task);
  pressChains.set(
    uuid,
    run.catch(() => {}),
  );
  return run;
}
