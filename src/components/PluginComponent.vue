<script setup>
import { onMounted, onBeforeUnmount } from "vue";
import {
  streamDeckReady,
  getStreamDeckClient,
} from "@/modules/common/sdConnect.js";
import { startPollingSupervisor } from "@/modules/plugin/pollingSupervisor.js";
import { wireLifecycleHandlers } from "@/modules/plugin/lifecycle.js";
import { globalSettings } from "@/modules/plugin/globalSettings.js";
import { refreshStateAndTitle } from "@/modules/plugin/renderDedupe.js";
// Side-effect import: registers all 11 action handlers into actionFunctionMap.
import "@/modules/actions/sonosActions.js";

// Plugin background runtime: subscribes to Stream Deck events, owns the
// SonosSpeakers store via the polling supervisor, and dispatches actions.
// Renders only debug text — the real value is in onMounted side effects.

let stopPolling = null;
let teardownLifecycle = null;

onMounted(async () => {
  const sd = await streamDeckReady;
  if (!sd) return;

  teardownLifecycle = wireLifecycleHandlers({ sd });
  sd.requestGlobalSettings();

  stopPolling = startPollingSupervisor({
    getDeviceCheckIntervalSeconds: () =>
      globalSettings.value.deviceCheckInterval ?? 10,
    // Polling uses the shorter 5s budget per prd-what.md §6;
    // action dispatch (etr.4) uses the 10s budget.
    getDeviceTimeoutDurationSeconds: () => 5,
    showAlert: ({ context }) => {
      const client = getStreamDeckClient();
      if (client) client.showAlert({ context });
    },
    refreshStateAndTitle: ({ inContext, inSonosSpeakerState }) =>
      refreshStateAndTitle({ inContext, inSonosSpeakerState }),
  });
});

onBeforeUnmount(() => {
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

<template>
  <div data-debug>Nothing to see here</div>
</template>
