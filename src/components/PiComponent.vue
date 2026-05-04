<script setup>
import { ref, computed, onMounted } from "vue";
import { streamDeckReady } from "@/modules/common/sdConnect.js";

const CONNECTION_STATE = Object.freeze({
  UNINITIALIZED: "UNINITIALIZED",
  CONNECTING: "CONNECTING",
  CONNECTED: "CONNECTED",
  DISCONNECTED: "DISCONNECTED",
});

const actionUUID = ref(null);
const settings = ref({});
const globalSettings = ref({});
const connectionState = ref(CONNECTION_STATE.UNINITIALIZED);

// Stub dispatchers — orw.11 (saveSettings) and orw.12 (saveGlobalSettings)
// fill in the per-context and global-scope schema/round-trip logic.
function saveSettings() {
  console.warn("PiComponent.saveSettings: not yet wired (orw.11 lands the implementation).");
}
function saveGlobalSettings() {
  console.warn("PiComponent.saveGlobalSettings: not yet wired (orw.12 lands the implementation).");
}

defineExpose({ saveSettings, saveGlobalSettings, connectionState, actionUUID, settings, globalSettings });

const isConnected = computed(() => connectionState.value === CONNECTION_STATE.CONNECTED);

onMounted(() => {
  connectionState.value = CONNECTION_STATE.CONNECTING;
  streamDeckReady.then(bindStreamDeck).catch((err) => {
    console.warn("StreamDeck bridge never resolved:", err);
    connectionState.value = CONNECTION_STATE.DISCONNECTED;
  });
});

function bindStreamDeck(sd) {
  // The client may have already received `connected` between bridge install
  // and this Promise callback. Read the cached actionInfo so we don't miss it.
  if (sd.connected) {
    actionUUID.value = sd.actionInfo?.action ?? null;
    connectionState.value = CONNECTION_STATE.CONNECTED;
  }
  sd.on("connected", (actionInfo) => {
    actionUUID.value = actionInfo?.action ?? null;
    connectionState.value = CONNECTION_STATE.CONNECTED;
  });
  sd.on("disconnected", () => {
    connectionState.value = CONNECTION_STATE.DISCONNECTED;
  });
  sd.on("error", (err) => {
    console.error("StreamDeck WebSocket error:", err);
    connectionState.value = CONNECTION_STATE.DISCONNECTED;
  });
  sd.on("didReceiveSettings", (msg) => {
    settings.value = msg?.payload?.settings ?? {};
  });
  sd.on("globalsettings", (incomingSettings) => {
    globalSettings.value = incomingSettings ?? {};
  });
}
</script>

<template>
  <div class="container-fluid p-2">
    <section class="mb-3" data-pi-section="sonos-speakers">
      <h1 class="h5">Sonos Speakers</h1>
      <p v-if="!isConnected" class="text-muted small mb-0">
        Set the Primary Device Address below and tap "Save and Connect" to discover your speakers.
      </p>
    </section>

    <section data-pi-section="global-settings">
      <h1 class="h5">Global Settings</h1>
      <p class="text-muted small mb-0">Discovery, timeouts, and volume increment land in bead orw.8.</p>
    </section>
  </div>
</template>
