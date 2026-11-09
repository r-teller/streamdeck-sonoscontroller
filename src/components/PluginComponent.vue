<template>
  <div class="plugin-runtime">Sonos Controller plugin runtime</div>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from "vue";
import { streamDeckReady, getStreamDeckClient } from "@/modules/common/sdConnect";
import { wireLifecycleHandlers } from "@/modules/plugin/lifecycle";
import { globalSettings } from "@/modules/plugin/globalSettings";
import { startPollingSupervisor } from "@/modules/plugin/pollingSupervisor";
import { refreshStateAndTitle } from "@/modules/plugin/renderDedupe";
import { startRenderTicker } from "@/modules/plugin/renderTicker";
import { syncFavoriteKeys } from "@/modules/plugin/favoriteKeys";
import "@/modules/actions/sonosActions";

let stopPolling = null;
let stopTicker = null;
let teardownLifecycle = null;

onMounted(async () => {
  const sd = await streamDeckReady;
  teardownLifecycle = wireLifecycleHandlers({ sd });
  sd.requestGlobalSettings();

  stopPolling = startPollingSupervisor({
    getDeviceCheckIntervalSeconds: () => globalSettings.deviceCheckInterval ?? 10,
    getDeviceTimeoutDurationSeconds: () => 5,
    showAlert: ({ context }) => getStreamDeckClient()?.showAlert({ context }),
    refreshStateAndTitle,
    afterPoll: (UUID) => syncFavoriteKeys({ UUID, sd }),
  });
  stopTicker = startRenderTicker({ refreshStateAndTitle });
});

onBeforeUnmount(() => {
  if (stopTicker) {
    stopTicker();
    stopTicker = null;
  }
  if (stopPolling) {
    stopPolling();
    stopPolling = null;
  }
  if (teardownLifecycle) {
    teardownLifecycle();
    teardownLifecycle = null;
  }
});
</script>
