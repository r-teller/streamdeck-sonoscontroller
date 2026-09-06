<script setup>
import { ref, computed, watch, onMounted } from "vue";
import { streamDeckReady } from "@/modules/common/sdConnect.js";
import { OPERATIONAL_STATUS } from "@/modules/plugin/operationalStatus.js";
import { buildActionSettingsPayload } from "@/modules/pi/actionSettingsSchema.js";
import { buildGlobalSettingsPayload } from "@/modules/pi/globalSettingsSchema.js";
import BootstrapAccordeon from "@/components/accordeon/BootstrapAccordeon.vue";
import BootstrapAccordeonItem from "@/components/accordeon/BootstrapAccordeonItem.vue";
import SonosSelection from "@/components/SonosSelection.vue";
import manifest from "@manifest";

const actionUUID = ref("");
const settings = ref({});
const globalSettings = ref({});
const connectionState = ref(OPERATIONAL_STATUS.DISCONNECTED);
const sdClient = ref(null);
const errorMessage = ref("");
const primaryDeviceAddress = ref("");
const isDiscovering = ref(false);
const speakers = ref([]);

const isConnected = computed(() => connectionState.value === OPERATIONAL_STATUS.CONNECTED && speakers.value.length > 0);

const boundSpeakerLabel = computed(
  () => settings.value.title ?? formatSpeakerTitle(settings.value.zoneName, settings.value.hostAddress),
);

function formatSpeakerTitle(zoneName, hostAddress) {
  return `${zoneName} (${hostAddress})`;
}

function bindStreamDeck(client) {
  sdClient.value = client;

  const handleConnected = () => {
    actionUUID.value = client.actionInfo?.action ?? "";
    settings.value = client.actionInfo?.payload?.settings ?? {};
    connectionState.value = OPERATIONAL_STATUS.CONNECTED;
    client.requestGlobalSettings();
  };

  if (client.connected) {
    handleConnected();
  }

  client.on("connected", handleConnected);
  client.on("disconnected", () => {
    connectionState.value = OPERATIONAL_STATUS.DISCONNECTED;
  });
  client.on("error", () => {
    connectionState.value = OPERATIONAL_STATUS.DISCONNECTED;
  });
  client.on("didReceiveSettings", (message) => {
    settings.value = message?.payload?.settings ?? {};
  });
  client.on("globalsettings", (incoming) => {
    globalSettings.value = incoming ?? {};
  });
}

function buildSaveInput(overrides = {}) {
  const manifestAction = manifest.Actions.find((entry) => entry.UUID === actionUUID.value);
  return buildActionSettingsPayload({
    action: actionUUID.value,
    states: manifestAction?.States ?? [],
    controller: sdClient.value?.actionInfo?.payload?.controller ?? "Keypad",
    current: settings.value,
    overrides,
  });
}

function saveSettings(overrides = {}) {
  const payload = buildSaveInput(overrides);
  settings.value = payload;
  sdClient.value?.saveSettings({ actionSettings: payload, context: sdClient.value.uuid });
  return payload;
}

function saveGlobalSettings(partial = {}) {
  const payload = buildGlobalSettingsPayload({ ...globalSettings.value, ...partial });
  globalSettings.value = payload;
  sdClient.value?.saveGlobalSettings({ payload });
  return payload;
}

function rebuildSpeakersFromDevices(devices) {
  speakers.value = Object.values(devices).map((d) => ({
    uuid: d.uuid,
    zoneName: d.zoneName,
    hostAddress: d.hostAddress,
    isSatellite: d.isSatellite === true,
  }));
}

function onSpeakerSelected(uuid) {
  const device = speakers.value.find((s) => s.uuid === uuid);
  if (!device) return;
  saveSettings({
    uuid: device.uuid,
    title: formatSpeakerTitle(device.zoneName, device.hostAddress),
    hostAddress: device.hostAddress,
    zoneName: device.zoneName,
  });
}

watch([actionUUID, globalSettings], () => {
  if (actionUUID.value && !settings.value?.uuid && sdClient.value) {
    const devices = globalSettings.value?.devices ?? {};
    const primary = Object.values(devices).find((d) => d.primary === true);
    if (primary) {
      saveSettings({
        uuid: primary.uuid,
        title: formatSpeakerTitle(primary.zoneName, primary.hostAddress),
        hostAddress: primary.hostAddress,
        zoneName: primary.zoneName,
      });
    }
  }
});

watch(globalSettings, () => {
  const devices = globalSettings.value?.devices;
  if (devices && Object.keys(devices).length > 0) {
    rebuildSpeakersFromDevices(devices);
    connectionState.value = OPERATIONAL_STATUS.CONNECTED;
    const primary = Object.values(devices).find((d) => d.primary === true);
    if (primary) {
      primaryDeviceAddress.value = primary.hostAddress;
    }
  }
});

onMounted(() => {
  connectionState.value = OPERATIONAL_STATUS.CONNECTING;
  streamDeckReady.then(bindStreamDeck).catch((error) => {
    console.warn("Stream Deck bridge unavailable:", error);
    connectionState.value = OPERATIONAL_STATUS.DISCONNECTED;
  });
});

defineExpose({
  actionUUID,
  settings,
  globalSettings,
  connectionState,
  sdClient,
  errorMessage,
  primaryDeviceAddress,
  isDiscovering,
  speakers,
  isConnected,
  bindStreamDeck,
  buildSaveInput,
  saveSettings,
  saveGlobalSettings,
  formatSpeakerTitle,
  onSpeakerSelected,
});
</script>

<template>
  <div class="container-fluid p-2">
    <section data-pi-section="sonos-speakers">
      <h1 class="h5">Sonos Speakers</h1>
      <BootstrapAccordeon v-if="isConnected" accordeon-id="sonos-speakers-accordeon">
        <BootstrapAccordeonItem item-id="AvailableSonosSpeakers" title="Available Sonos Speakers" :force-expanded="false">
          <SonosSelection :model-value="settings.uuid ?? ''" :speakers="speakers" @selection-saved="onSpeakerSelected" />
        </BootstrapAccordeonItem>
      </BootstrapAccordeon>
      <p v-else class="text-muted" data-pi-disconnected-hint>
        Set the Primary Device Address below and tap "Save and Connect" to discover your speakers.
      </p>
      <div v-if="settings.uuid" class="alert alert-light" role="status" data-pi-bound-speaker-alert>
        <small>{{ boundSpeakerLabel }}</small>
      </div>
    </section>
    <section data-pi-section="global-settings"></section>
  </div>
</template>
