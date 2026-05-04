import { StreamDeck } from "@/modules/common/streamdeck.js";

// The Stream Deck application calls `window.connectElgatoStreamDeckSocket`
// AFTER the page's scripts have loaded — too late for a Vue `onMounted` hook
// to read `window.$SD` synchronously. The bridge must be installed at module
// load time (from each entry's main.js, before Vue mounts). Consumers await
// the `streamDeckReady` Promise to get the client whenever it shows up.

let resolveReady;
let resolveRejected;

/**
 * Resolves with the `StreamDeck` client once Stream Deck calls into the page.
 * Resolves only once; later `connectElgatoStreamDeckSocket` calls overwrite
 * the client but the Promise is already settled. Treat as one-shot.
 */
export const streamDeckReady = new Promise((resolve, reject) => {
  resolveReady = resolve;
  resolveRejected = reject;
});

let currentClient = null;

/**
 * The most recent client constructed by the bridge, or `null` until Stream
 * Deck has connected. Useful for callers that want a synchronous snapshot.
 */
export function getStreamDeckClient() {
  return currentClient;
}

/**
 * Install the global SDK bridge. Call this from each entry's main.js BEFORE
 * Vue mounts, so the function is available when Stream Deck calls into the
 * page. Idempotent within a single page lifecycle.
 */
export function installStreamDeckBridge() {
  if (window.connectElgatoStreamDeckSocket) return;
  window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, info, actionInfo) => {
    currentClient = new StreamDeck({ port, uuid, registerEvent, actionInfo });
    window.$SD = currentClient;
    resolveReady(currentClient);
    return currentClient;
  };
}

/**
 * Tear down the bridge. Closes the active client and clears globals. Use in
 * tests; production runs do not need this since plugin reload terminates the
 * webview.
 */
export function teardownStreamDeckBridge() {
  if (currentClient) {
    currentClient.close();
    currentClient = null;
  }
  delete window.connectElgatoStreamDeckSocket;
  delete window.$SD;
  // Reject the ready Promise if it's still pending so awaiters don't hang.
  resolveRejected?.(new Error("StreamDeck bridge torn down"));
}
