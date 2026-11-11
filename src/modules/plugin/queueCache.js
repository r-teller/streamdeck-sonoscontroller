/**
 * Queue contents for the Queue Track dial (sonos-gen.2), per speaker.
 *
 * The poller reads the queue signature (version, size, first track) for speakers with a queue dial;
 * when it changes, the items are fetched again in chunks. Dials read items synchronously and get a
 * redraw when a fetch completes. Queues longer than MAX_ITEMS still work: tracks past the limit are
 * shown as "Track N" cards and can be played by number.
 */

export const CHUNK = 100;
export const MAX_ITEMS = 500;

const cache = new Map(); // uuid -> { key, items: Array, loading: Promise|null }
let onLoaded = () => {};

/** Called with the speaker uuid after its queue items were (re)loaded. */
export function setQueueLoadedHook(hook) {
  onLoaded = typeof hook === "function" ? hook : () => {};
}

function signatureKey(sig) {
  return sig ? `${sig.updateId}|${sig.total}|${sig.firstTrackUri}` : "";
}

async function load(uuid, controller, sig, entry) {
  const total = Math.min(Number(sig?.total) || 0, MAX_ITEMS);
  const items = [];
  try {
    for (let start = 0; start < total; start += CHUNK) {
      const page = await controller.getQueue({ startIndex: start, requestedCount: Math.min(CHUNK, total - start) });
      items.push(...(page?.list ?? []));
      if (!page?.list?.length) break;
    }
    if (cache.get(uuid) === entry) {
      entry.items = items;
      onLoaded(uuid);
    }
  } catch (e) {
    // Forget the signature so the next read (next render or poll) fetches again.
    if (cache.get(uuid) === entry) entry.key = "";
  } finally {
    entry.loading = null;
  }
}

/**
 * Items known for this speaker's queue. Starts a (re)load when the signature differs from the one
 * the cached items belong to.
 *
 * @param {string} uuid
 * @param {{updateId: string, total: number, firstTrackUri: string} | null} signature
 * @param {() => {getQueue: Function}} makeController
 * @returns {Array<{title: string, artist: string, album: string, uri: string, albumArtURI: string}>}
 */
export function queueItems(uuid, signature, makeController) {
  const key = signatureKey(signature);
  let entry = cache.get(uuid);
  if (!entry || entry.key !== key) {
    const fresh = { key, items: entry?.key === key ? entry.items : [], loading: null };
    cache.set(uuid, fresh);
    entry = fresh;
    if (key && Number(signature.total) > 0) entry.loading = load(uuid, makeController(), signature, entry);
  }
  return entry.items;
}

/** Test hook: wait for an in-flight load. */
export function _pendingLoad(uuid) {
  return cache.get(uuid)?.loading ?? Promise.resolve();
}

export function _resetQueueCache() {
  cache.clear();
}
