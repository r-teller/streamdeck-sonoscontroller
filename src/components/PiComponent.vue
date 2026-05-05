<script setup>
import { ref, computed, onMounted, watch } from "vue";
import { streamDeckReady } from "@/modules/common/sdConnect.js";
import { SonosController } from "@/modules/common/sonosController.js";
import SonosSelection from "@/components/SonosSelection.vue";
import {
  buildActionSettingsPayload,
  actionShortName,
  DISPLAY_STATE_TITLE_ACTIONS,
  DISPLAY_MARQUEE_TITLE_ACTIONS,
  DISPLAY_MARQUEE_ALBUM_TITLE_ACTIONS,
  DISPLAY_ALBUM_ART_ACTIONS,
  PLAY_MODE_DEFAULTS,
  INPUT_SOURCE_DEFAULTS,
} from "@/modules/pi/actionSettingsSchema.js";
import { buildGlobalSettingsPayload } from "@/modules/pi/globalSettingsSchema.js";
import BootstrapAccordeon from "@/components/accordeon/BootstrapAccordeon.vue";
import BootstrapAccordeonItem from "@/components/accordeon/BootstrapAccordeonItem.vue";

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
const sdClient = ref(null);
const errorMessage = ref(null);
// Discovery seed IP is session-only — not part of the global settings blob
// (the persisted `devices` map carries `primary: true` on the seed instead).
const primaryDeviceAddress = ref("");

function dismissError() {
  errorMessage.value = null;
}

function updateGlobalField(key, value) {
  globalSettings.value = { ...globalSettings.value, [key]: value };
}

const isDiscovering = ref(false);
const speakers = ref([]);

function rebuildSpeakersFromDevices(devicesMap) {
  return Object.values(devicesMap ?? {}).map((d) => ({
    uuid: d.uuid,
    zoneName: d.zoneName,
    hostAddress: d.hostAddress,
    isSatellite: !!d.isSatellite,
  }));
}

function formatSpeakerTitle(device) {
  return `${device.zoneName} (${device.hostAddress})`;
}

function saveSettings(input) {
  if (!sdClient.value) {
    console.warn("PiComponent.saveSettings: SDK not connected");
    return null;
  }
  const context = sdClient.value.uuid;
  const payload = buildActionSettingsPayload(input);
  sdClient.value.saveSettings({ actionSettings: payload, context });
  settings.value = payload;
  return payload;
}

const shortName = computed(() => actionShortName(actionUUID.value));

const showDisplayStateBasedTitle = computed(() =>
  DISPLAY_STATE_TITLE_ACTIONS.has(shortName.value),
);
const showDisplayMarqueeTitle = computed(() =>
  DISPLAY_MARQUEE_TITLE_ACTIONS.has(shortName.value),
);
const showDisplayMarqueeAlbumTitle = computed(() =>
  DISPLAY_MARQUEE_ALBUM_TITLE_ACTIONS.has(shortName.value),
);
const showDisplayAlbumArt = computed(() =>
  DISPLAY_ALBUM_ART_ACTIONS.has(shortName.value),
);

const showPlayModes = computed(() => shortName.value === "toggle-play-mode");
const showInputSources = computed(
  () => shortName.value === "toggle-input-source",
);
const showEqualizerTarget = computed(
  () => shortName.value === "encoder-audio-equalizer",
);
const showFavorites = computed(
  () => shortName.value === "play-sonos-favorite",
);

const PLAY_MODE_LABELS = {
  NORMAL: "Normal",
  SHUFFLE_NOREPEAT: "Shuffle No Repeat",
  SHUFFLE_REPEAT_ONE: "Shuffle Repeat One",
  SHUFFLE: "Shuffle",
  REPEAT_ONE: "Repeat One",
  REPEAT_ALL: "Repeat All",
};
const INPUT_SOURCE_LABELS = {
  Sonos_Queue: "Sonos Queue",
  TV_Input: "Tv Input",
  Line_In: "Line In",
};
const EQ_TARGET_LABELS = { VOLUME: "Volume", BASS: "Bass", TREBLE: "Treble" };
const PLAY_MODE_OPTIONS = [...PLAY_MODE_DEFAULTS];
const INPUT_SOURCE_OPTIONS = [...INPUT_SOURCE_DEFAULTS];
const EQ_TARGET_OPTIONS = ["VOLUME", "BASS", "TREBLE"];

const selectedPlayModes = computed(
  () => settings.value.selectedPlayModes ?? [...PLAY_MODE_DEFAULTS],
);
const selectedInputSources = computed(
  () => settings.value.selectedInputSources ?? [...INPUT_SOURCE_DEFAULTS],
);

function isPlayModeChecked(mode) {
  return selectedPlayModes.value.includes(mode);
}
function onPlayModeToggle(mode, event) {
  const next = event.target.checked
    ? [...selectedPlayModes.value, mode]
    : selectedPlayModes.value.filter((m) => m !== mode);
  // Re-sort to canonical order so the persisted array shape is stable.
  const canonical = PLAY_MODE_OPTIONS.filter((m) => next.includes(m));
  saveSettings(buildSaveInput({ selectedPlayModes: canonical }));
}

function isInputSourceChecked(source) {
  return selectedInputSources.value.includes(source);
}
function onInputSourceToggle(source, event) {
  const next = event.target.checked
    ? [...selectedInputSources.value, source]
    : selectedInputSources.value.filter((s) => s !== source);
  const canonical = INPUT_SOURCE_OPTIONS.filter((s) => next.includes(s));
  saveSettings(buildSaveInput({ selectedInputSources: canonical }));
}

function onEqTargetChange(event) {
  saveSettings(
    buildSaveInput({ encoderAudioEqualizerTarget: event.target.value }),
  );
}

const favoritesList = computed(() => globalSettings.value?.favorites ?? []);
const selectedFavoriteUri = computed(
  () => settings.value.selectedSonosFavorite?.uri ?? favoritesList.value[0]?.uri ?? "",
);
function onFavoriteChange(event) {
  const uri = event.target.value;
  const fav = favoritesList.value.find((f) => f.uri === uri);
  if (!fav) return;
  saveSettings(buildSaveInput({ selectedSonosFavorite: { ...fav } }));
}

const VOLUME_INCREMENT_ACTIONS = new Set(["volume-up", "volume-down"]);
const showVolumeIncrement = computed(() =>
  VOLUME_INCREMENT_ACTIONS.has(shortName.value),
);
const globalAdjustVolumeIncrement = computed(
  () => globalSettings.value?.adjustVolumeIncrement ?? 10,
);
const volumeIncrementOverride = computed({
  get() {
    const v = settings.value.adjustVolumeIncrement;
    return v == null ? "" : v;
  },
  set(next) {
    // Save on each change. Empty string and null persist as null (inherit
    // global default); numeric values persist verbatim — orw.11 schema
    // builder owns the `?? null` semantics.
    saveSettings(
      buildSaveInput({
        adjustVolumeIncrement: next === "" ? null : Number(next),
      }),
    );
  },
});

function buildSaveInput(overrides = {}) {
  const info = sdClient.value?.actionInfo ?? {};
  return {
    action: actionUUID.value ?? info.action,
    states: settings.value.states ?? info.states ?? [],
    controller: settings.value.controller ?? info.controller ?? "Keypad",
    uuid: settings.value.uuid,
    title: settings.value.title,
    hostAddress: settings.value.hostAddress,
    zoneName: settings.value.zoneName,
    selectedPlayModes: settings.value.selectedPlayModes,
    selectedInputSources: settings.value.selectedInputSources,
    encoderAudioEqualizerTarget: settings.value.encoderAudioEqualizerTarget,
    displayStateBasedTitle: settings.value.displayStateBasedTitle,
    displayAlbumArt: settings.value.displayAlbumArt,
    displayMarqueeTitle: settings.value.displayMarqueeTitle,
    displayMarqueeAlbumTitle: settings.value.displayMarqueeAlbumTitle,
    selectedSonosFavorite: settings.value.selectedSonosFavorite,
    adjustVolumeIncrement: settings.value.adjustVolumeIncrement,
    ...overrides,
  };
}

function onPresentationToggle(field, event) {
  saveSettings(buildSaveInput({ [field]: event.target.checked }));
}

function saveGlobalSettings(input) {
  if (!sdClient.value) {
    console.warn("PiComponent.saveGlobalSettings: SDK not connected");
    return null;
  }
  const payload = buildGlobalSettingsPayload(input);
  sdClient.value.saveGlobalSettings({ payload });
  globalSettings.value = payload;
  return payload;
}

defineExpose({
  saveSettings,
  saveGlobalSettings,
  connectionState,
  actionUUID,
  settings,
  globalSettings,
  sdClient,
  errorMessage,
  dismissError,
  buildSaveInput,
  primaryDeviceAddress,
  saveAndConnect,
  isDiscovering,
  speakers,
  onSpeakerSelected,
});

const isConnected = computed(() => connectionState.value === CONNECTION_STATE.CONNECTED);

const saveAndConnectLabel = computed(() =>
  isConnected.value ? "Save and Reconnect" : "Save and Connect",
);
const saveAndConnectDisabled = computed(
  () => !primaryDeviceAddress.value.trim() || isDiscovering.value,
);

async function saveAndConnect() {
  if (saveAndConnectDisabled.value) return;
  isDiscovering.value = true;
  try {
    const timeoutSec = globalSettings.value?.deviceTimeoutDuration ?? 10;
    const checkInterval = globalSettings.value?.deviceCheckInterval ?? 10;
    const increment = globalSettings.value?.adjustVolumeIncrement ?? 10;
    const controller = new SonosController({ timeoutSec });
    controller.connect(primaryDeviceAddress.value.trim());

    // Both calls share the same controller instance so the topology XML
    // (memoized inside getDevices via getZoneGroupState) is fetched once.
    const [devices, favorites] = await Promise.all([
      controller.getDevices({ setAsPrimary: true }),
      controller.getFavorites(),
    ]);

    const devicesMap = {};
    for (const d of devices) devicesMap[d.uuid] = d;

    saveGlobalSettings({
      devices: devicesMap,
      deviceCheckInterval: checkInterval,
      deviceTimeoutDuration: timeoutSec,
      adjustVolumeIncrement: increment,
      favorites,
    });

    speakers.value = rebuildSpeakersFromDevices(devicesMap);
    errorMessage.value = null;
    connectionState.value = CONNECTION_STATE.CONNECTED;

    // Selected-speaker default: if the current action has no bound speaker,
    // pick the discovery seed (primary device).
    if (actionUUID.value && !settings.value.uuid) {
      const primary = devices.find((d) => d.primary);
      if (primary) defaultBindToPrimary(primary);
    }
  } catch (err) {
    errorMessage.value = err?.message ?? String(err);
  } finally {
    isDiscovering.value = false;
  }
}

function defaultBindToPrimary(primary) {
  saveSettings(
    buildSaveInput({
      uuid: primary.uuid,
      title: formatSpeakerTitle(primary),
      hostAddress: primary.hostAddress,
      zoneName: primary.zoneName,
    }),
  );
}

function onSpeakerSelected(uuid) {
  const devices = globalSettings.value?.devices ?? {};
  const device = devices[uuid];
  if (!device) return;
  saveSettings(
    buildSaveInput({
      uuid: device.uuid,
      title: formatSpeakerTitle(device),
      hostAddress: device.hostAddress,
      zoneName: device.zoneName,
    }),
  );
}

// Drop-new-action default: when a brand-new action arrives (actionUUID set)
// after discovery has already succeeded, bind to the primary device.
watch(actionUUID, (newUUID) => {
  if (!newUUID || settings.value.uuid) return;
  const devices = globalSettings.value?.devices ?? {};
  const primary = Object.values(devices).find((d) => d.primary);
  if (primary && sdClient.value) defaultBindToPrimary(primary);
});

// Rebuild the picker list whenever devices arrive via didReceiveGlobalSettings
// (i.e., when the user reopens the PI after discovery already succeeded).
watch(
  () => globalSettings.value?.devices,
  (devicesMap) => {
    if (devicesMap && Object.keys(devicesMap).length > 0) {
      speakers.value = rebuildSpeakersFromDevices(devicesMap);
      if (connectionState.value !== CONNECTION_STATE.CONNECTED) {
        connectionState.value = CONNECTION_STATE.CONNECTED;
      }
    }
  },
  { immediate: true },
);

onMounted(() => {
  connectionState.value = CONNECTION_STATE.CONNECTING;
  streamDeckReady.then(bindStreamDeck).catch((err) => {
    console.warn("StreamDeck bridge never resolved:", err);
    connectionState.value = CONNECTION_STATE.DISCONNECTED;
  });
});

function bindStreamDeck(sd) {
  sdClient.value = sd;
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
      <BootstrapAccordeon
        v-if="isConnected"
        accordeon-id="sonos-speakers-accordeon"
      >
        <BootstrapAccordeonItem
          item-id="AvailableSonosSpeakers"
          title="Available Sonos Speakers"
          :force-expanded="false"
        >
          <SonosSelection
            :model-value="settings.uuid ?? null"
            :speakers="speakers"
            @selection-saved="onSpeakerSelected"
          />
        </BootstrapAccordeonItem>
      </BootstrapAccordeon>
      <p v-else class="text-muted small mb-0">
        Set the Primary Device Address below and tap "Save and Connect" to discover your speakers.
      </p>
      <div
        v-if="settings.uuid"
        class="alert alert-light mt-2 mb-0 py-1 px-2 small"
        role="status"
        data-pi-bound-speaker-alert
      >
        {{ settings.zoneName }} ({{ settings.hostAddress }})
      </div>
    </section>

    <section
      v-if="
        showDisplayStateBasedTitle ||
        showDisplayMarqueeTitle ||
        showDisplayMarqueeAlbumTitle ||
        showDisplayAlbumArt
      "
      class="mb-3"
      data-pi-section="presentation-toggles"
    >
      <div
        v-if="showDisplayStateBasedTitle"
        class="form-check form-switch"
        data-pi-toggle-state-based-title
      >
        <input
          id="toggle-display-state-based-title"
          type="checkbox"
          class="form-check-input"
          :checked="settings.displayStateBasedTitle === true"
          @change="onPresentationToggle('displayStateBasedTitle', $event)"
        />
        <label class="form-check-label" for="toggle-display-state-based-title">
          Display State Based Title
        </label>
      </div>
      <div
        v-if="showDisplayMarqueeTitle"
        class="form-check form-switch"
        data-pi-toggle-marquee-title
      >
        <input
          id="toggle-display-marquee-title"
          type="checkbox"
          class="form-check-input"
          :checked="settings.displayMarqueeTitle === true"
          @change="onPresentationToggle('displayMarqueeTitle', $event)"
        />
        <label class="form-check-label" for="toggle-display-marquee-title">
          Display Marquee Title
        </label>
      </div>
      <div
        v-if="showDisplayMarqueeAlbumTitle"
        class="form-check form-switch"
        data-pi-toggle-marquee-album-title
      >
        <input
          id="toggle-display-marquee-album-title"
          type="checkbox"
          class="form-check-input"
          :checked="settings.displayMarqueeAlbumTitle === true"
          @change="onPresentationToggle('displayMarqueeAlbumTitle', $event)"
        />
        <label
          class="form-check-label"
          for="toggle-display-marquee-album-title"
        >
          Display Marquee Album Title
        </label>
      </div>
      <div
        v-if="showDisplayAlbumArt"
        class="form-check form-switch"
        data-pi-toggle-album-art
      >
        <input
          id="toggle-display-album-art"
          type="checkbox"
          class="form-check-input"
          :checked="settings.displayAlbumArt === true"
          @change="onPresentationToggle('displayAlbumArt', $event)"
        />
        <label class="form-check-label" for="toggle-display-album-art">
          Display Album Art
        </label>
      </div>
    </section>

    <section
      v-if="showPlayModes"
      class="mb-3"
      data-pi-section="play-modes"
    >
      <h1 class="h5">Play Mode(s)</h1>
      <div
        v-for="mode in PLAY_MODE_OPTIONS"
        :key="mode"
        class="form-check form-switch"
        :data-pi-play-mode="mode"
      >
        <input
          :id="`play-mode-${mode}`"
          type="checkbox"
          class="form-check-input"
          :checked="isPlayModeChecked(mode)"
          @change="onPlayModeToggle(mode, $event)"
        />
        <label class="form-check-label" :for="`play-mode-${mode}`">
          {{ PLAY_MODE_LABELS[mode] }}
        </label>
      </div>
    </section>

    <section
      v-if="showInputSources"
      class="mb-3"
      data-pi-section="input-sources"
    >
      <h1 class="h5">Input Source(s)</h1>
      <div
        v-for="src in INPUT_SOURCE_OPTIONS"
        :key="src"
        class="form-check form-switch"
        :data-pi-input-source="src"
      >
        <input
          :id="`input-source-${src}`"
          type="checkbox"
          class="form-check-input"
          :checked="isInputSourceChecked(src)"
          @change="onInputSourceToggle(src, $event)"
        />
        <label class="form-check-label" :for="`input-source-${src}`">
          {{ INPUT_SOURCE_LABELS[src] }}
        </label>
      </div>
    </section>

    <section
      v-if="showEqualizerTarget"
      class="mb-3"
      data-pi-section="equalizer-target"
    >
      <h1 class="h5">Equalizer Target</h1>
      <select
        class="form-select"
        :value="settings.encoderAudioEqualizerTarget ?? 'VOLUME'"
        data-pi-eq-target-select
        @change="onEqTargetChange"
      >
        <option v-for="t in EQ_TARGET_OPTIONS" :key="t" :value="t">
          {{ EQ_TARGET_LABELS[t] }}
        </option>
      </select>
    </section>

    <section
      v-if="showFavorites"
      class="mb-3"
      data-pi-section="sonos-favorites"
    >
      <h1 class="h5">Sonos Favorite(s)</h1>
      <select
        class="form-select"
        :value="selectedFavoriteUri"
        data-pi-favorite-select
        @change="onFavoriteChange"
      >
        <option v-for="fav in favoritesList" :key="fav.uri" :value="fav.uri">
          {{ fav.title }}
        </option>
      </select>
    </section>

    <section
      v-if="showVolumeIncrement"
      class="mb-3"
      data-pi-section="volume-increment-override"
    >
      <h1 class="h5">Volume Increment</h1>
      <label class="form-label" for="volume-increment-override-input">
        Override increment (leave empty to use global default)
      </label>
      <input
        id="volume-increment-override-input"
        type="number"
        min="1"
        class="form-control"
        :value="volumeIncrementOverride"
        :placeholder="`Global default: ${globalAdjustVolumeIncrement}`"
        data-pi-volume-increment-override
        @change="volumeIncrementOverride = $event.target.value"
      />
      <div class="form-text">Volume range: 0–100</div>
    </section>

    <section data-pi-section="global-settings">
      <h1 class="h5">Global Settings</h1>
      <BootstrapAccordeon accordeon-id="global-settings-accordeon">
        <BootstrapAccordeonItem
          item-id="GlobalSettings"
          title="Global Settings"
          :force-expanded="!isConnected"
        >
          <div
            v-if="errorMessage"
            class="alert alert-danger alert-dismissible fade show"
            role="alert"
            data-pi-error-alert
          >
            {{ errorMessage }}
            <button
              type="button"
              class="btn-close"
              aria-label="Close"
              @click="dismissError"
            ></button>
          </div>

          <div class="mb-3">
            <label class="form-label" for="global-primary-device-address">
              Primary Device Address (Discovery)
            </label>
            <input
              id="global-primary-device-address"
              v-model="primaryDeviceAddress"
              type="text"
              class="form-control"
              data-pi-primary-device-address
            />
            <div class="form-text">
              Note: This device is used to discover all other devices on the network
            </div>
          </div>

          <div class="mb-3">
            <label class="form-label" for="global-device-timeout-duration">
              Device Timeout Duration (Actions)
            </label>
            <input
              id="global-device-timeout-duration"
              type="number"
              min="1"
              class="form-control"
              :value="globalSettings.deviceTimeoutDuration ?? 10"
              data-pi-device-timeout-duration
              @input="
                updateGlobalField(
                  'deviceTimeoutDuration',
                  Number($event.target.value),
                )
              "
            />
            <div class="form-text">
              Note: This timeout is used when executing device actions (in seconds)
            </div>
          </div>

          <div class="mb-3">
            <label class="form-label" for="global-device-check-interval">
              Device Check Interval (Actions)
            </label>
            <input
              id="global-device-check-interval"
              type="number"
              min="1"
              class="form-control"
              :value="globalSettings.deviceCheckInterval ?? 10"
              data-pi-device-check-interval
              @input="
                updateGlobalField(
                  'deviceCheckInterval',
                  Number($event.target.value),
                )
              "
            />
            <div class="form-text">
              Note: This interval is used to check the status of the device selected for this action (in seconds)
            </div>
          </div>

          <div class="mb-3">
            <label class="form-label" for="global-volume-increment">
              Volume Increment (Up/Down)
            </label>
            <input
              id="global-volume-increment"
              type="number"
              min="1"
              class="form-control"
              :value="globalSettings.adjustVolumeIncrement ?? 10"
              data-pi-volume-increment
              @input="
                updateGlobalField(
                  'adjustVolumeIncrement',
                  Number($event.target.value),
                )
              "
            />
            <div class="form-text">
              Note: Volume range is 0–100. Used by Volume Up and Volume Down actions unless overridden per-button.
            </div>
          </div>

          <div class="d-flex justify-content-end">
            <button
              type="button"
              class="btn btn-primary"
              :disabled="saveAndConnectDisabled"
              data-pi-save-and-connect
              @click="saveAndConnect"
            >
              <span
                v-if="isDiscovering"
                class="spinner-border spinner-border-sm me-2"
                role="status"
                aria-hidden="true"
                data-pi-save-and-connect-spinner
              ></span>
              {{ saveAndConnectLabel }}
            </button>
          </div>
        </BootstrapAccordeonItem>
      </BootstrapAccordeon>
    </section>
  </div>
</template>
