import { StreamDeck } from "./streamdeck.js";

let client = null;
let resolveReady = null;
let rejectReady = null;
export let streamDeckReady = null;

function createReadyPromise() {
  return new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
}

function getStreamDeckClient() {
  return client;
}

function installStreamDeckBridge() {
  if (window.connectElgatoStreamDeckSocket) {
    return;
  }

  window.connectElgatoStreamDeckSocket = (port, uuid, registerEvent, info, actionInfo) => {
    client = new StreamDeck({ port, uuid, registerEvent, actionInfo });

    window.$SD = client;

    if (resolveReady) {
      resolveReady(client);
      resolveReady = null;
      rejectReady = null;
    }

    return client;
  };
}

function teardownStreamDeckBridge() {
  if (client) {
    client.close();
    client = null;
  }

  if (window.connectElgatoStreamDeckSocket) {
    delete window.connectElgatoStreamDeckSocket;
  }

  if (window.$SD) {
    delete window.$SD;
  }

  if (rejectReady) {
    rejectReady(new Error("Stream Deck bridge torn down while still pending"));
    resolveReady = null;
    rejectReady = null;
  }

  streamDeckReady = createReadyPromise();
}

streamDeckReady = createReadyPromise();

export { getStreamDeckClient, installStreamDeckBridge, teardownStreamDeckBridge };
