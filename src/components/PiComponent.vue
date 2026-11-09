<script setup>
import { ref, computed, watch, onMounted, nextTick } from "vue";
import { streamDeckReady } from "@/modules/common/sdConnect.js";
import { OPERATIONAL_STATUS } from "@/modules/plugin/operationalStatus.js";
import { buildActionSettingsPayload } from "@/modules/pi/actionSettingsSchema.js";
import { buildGlobalSettingsPayload } from "@/modules/pi/globalSettingsSchema.js";
import BootstrapAccordeon from "@/components/accordeon/BootstrapAccordeon.vue";
import BootstrapAccordeonItem from "@/components/accordeon/BootstrapAccordeonItem.vue";
import SonosSelection from "@/components/SonosSelection.vue";
import SpeakerBindings from "@/components/SpeakerBindings.vue";
import { isBindingMissing } from "@/modules/common/speakerResolver.js";
import { FAVORITE_SHORT_NAME, migrateFavoriteSettings } from "@/modules/common/favoriteSettings.js";
import manifest from "@manifest";
import { SonosController } from "@/modules/common/sonosController.js";
import {
  PLAY_MODES,
  INPUT_SOURCES,
  STATE_BASED_TITLE_ACTIONS,
  MARQUEE_TITLE_ACTIONS,
  MARQUEE_ALBUM_TITLE_ACTIONS,
  ALBUM_ART_ACTIONS,
  actionShortName,
  encodeFavoriteMetadata,
} from "@/modules/pi/actionSettingsSchema.js";

const actionUUID = ref("");
const settings = ref({});
const globalSettings = ref({});
const connectionState = ref(OPERATIONAL_STATUS.DISCONNECTED);
const sdClient = ref(null);
const errorMessage = ref("");
const primaryDeviceAddress = ref("");
const isDiscovering = ref(false);
const speakers = ref([]);
const deviceTimeoutDuration = ref(10);
const deviceCheckInterval = ref(10);
const adjustVolumeIncrement = ref(10);
const bindings = ref([]);
const forceGlobalsOpen = ref(false);
const bindingsSection = ref(null);

const currentSpeakerMissing = computed(() => isBindingMissing(settings.value, globalSettings.value));

// The PI is served from <StreamDeck data>/Plugins/<plugin>.sdPlugin/pi.html; profiles live in <StreamDeck data>/ProfilesV2.
const profilesFolderUrl = computed(() => {
  if (typeof window === "undefined" || window.location.protocol !== "file:") return null;
  return new URL("../../ProfilesV2/", window.location.href).href;
});

const isConnected = computed(() => connectionState.value === OPERATIONAL_STATUS.CONNECTED && speakers.value.length > 0);

const boundSpeakerLabel = computed(
  () => settings.value.title ?? formatSpeakerTitle(settings.value.zoneName, settings.value.hostAddress),
);

const shortName = computed(() => actionShortName(actionUUID.value));

const showDisplayStateBasedTitle = computed(() => STATE_BASED_TITLE_ACTIONS.has(shortName.value));
const showDisplayMarqueeTitle = computed(() => MARQUEE_TITLE_ACTIONS.has(shortName.value));
const showDisplayMarqueeAlbumTitle = computed(() => MARQUEE_ALBUM_TITLE_ACTIONS.has(shortName.value));
const showDisplayAlbumArt = computed(() => ALBUM_ART_ACTIONS.has(shortName.value));
const showFavoriteToggles = computed(() => shortName.value === FAVORITE_SHORT_NAME);
const FAVORITE_TOGGLES = [
  { key: "displayFavoriteName", label: "Display Favorite Name" },
  { key: "displayTrackTitle", label: "Display Track Title" },
  { key: "displayMarquee", label: "Marquee", requires: "displayTrackTitle" },
  { key: "displayFavoriteArtwork", label: "Display Favorite Artwork" },
  { key: "displayTrackArtwork", label: "Display Track/Album Artwork" },
];
const showPresentationToggles = computed(
  () =>
    showFavoriteToggles.value ||
    showDisplayStateBasedTitle.value ||
    showDisplayMarqueeTitle.value ||
    showDisplayMarqueeAlbumTitle.value ||
    showDisplayAlbumArt.value,
);

function formatSpeakerTitle(zoneName, hostAddress) {
  return `${zoneName} (${hostAddress})`;
}

function bindStreamDeck(client) {
  sdClient.value = client;

  const handleConnected = () => {
    actionUUID.value = client.actionInfo?.action ?? "";
    settings.value = normalizeSettings(client.actionInfo?.payload?.settings ?? {});
    connectionState.value = OPERATIONAL_STATUS.CONNECTED;
    client.requestGlobalSettings();
    requestBindings();
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
    settings.value = normalizeSettings(message?.payload?.settings ?? {});
  });
  client.on("globalsettings", (incoming) => {
    globalSettings.value = incoming ?? {};
  });
  client.on("sendToPropertyInspector", (message) => {
    const payload = message?.payload;
    if (payload?.type === "bindings" && Array.isArray(payload.bindings)) {
      bindings.value = payload.bindings;
    }
  });
}

// Favorite keys saved before the five favorite toggles existed are mapped onto them (sonos-gw5).
function normalizeSettings(raw) {
  return actionShortName(actionUUID.value) === FAVORITE_SHORT_NAME ? migrateFavoriteSettings(raw) : raw;
}

function requestBindings() {
  const client = sdClient.value;
  client?.sendToPlugin?.({ action: actionUUID.value, context: client.uuid, payload: { type: "getBindings" } });
}

function setReplacements(next) {
  saveGlobalSettings({ speakerReplacements: next });
  // The plugin reconciles buttons and pushes fresh bindings on didReceiveGlobalSettings; ask again as a fallback.
  setTimeout(requestBindings, 500);
}

function onReplaceSpeaker({ from, to }) {
  if (!from || !to || from === to) return;
  setReplacements({ ...(globalSettings.value?.speakerReplacements ?? {}), [from]: to });
}

function onUndoReplacement({ from }) {
  const next = { ...(globalSettings.value?.speakerReplacements ?? {}) };
  delete next[from];
  setReplacements(next);
}

async function showSpeakerBindings() {
  forceGlobalsOpen.value = true;
  await nextTick();
  bindingsSection.value?.scrollIntoView?.({ behavior: "smooth", block: "start" });
}

function openProfilesFolder() {
  if (profilesFolderUrl.value) sdClient.value?.openUrl?.({ url: profilesFolderUrl.value });
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
  deviceTimeoutDuration.value = globalSettings.value?.deviceTimeoutDuration ?? 10;
  deviceCheckInterval.value = globalSettings.value?.deviceCheckInterval ?? 10;
  adjustVolumeIncrement.value = globalSettings.value?.adjustVolumeIncrement ?? 10;
});

onMounted(() => {
  connectionState.value = OPERATIONAL_STATUS.CONNECTING;
  streamDeckReady.then(bindStreamDeck).catch((error) => {
    console.warn("Stream Deck bridge unavailable:", error);
    connectionState.value = OPERATIONAL_STATUS.DISCONNECTED;
  });
});

async function saveAndConnect() {
  isDiscovering.value = true;
  try {
    const controller = new SonosController({ timeoutSec: deviceTimeoutDuration.value ?? 10 });
    controller.connect(primaryDeviceAddress.value.trim());
    const [deviceList, favorites] = await Promise.all([
      controller.getDevices({ setAsPrimary: true }),
      controller.getFavorites(),
    ]);
    const devices = {};
    for (const device of deviceList) {
      devices[device.uuid] = device;
    }
    const payload = saveGlobalSettings({
      devices,
      deviceCheckInterval: deviceCheckInterval.value,
      deviceTimeoutDuration: deviceTimeoutDuration.value,
      adjustVolumeIncrement: adjustVolumeIncrement.value,
      favorites,
    });
    deviceCheckInterval.value = payload.deviceCheckInterval;
    deviceTimeoutDuration.value = payload.deviceTimeoutDuration;
    adjustVolumeIncrement.value = payload.adjustVolumeIncrement;
    rebuildSpeakersFromDevices(devices);
    errorMessage.value = "";
    connectionState.value = OPERATIONAL_STATUS.CONNECTED;
    if (!settings.value?.uuid) {
      const primaryDevice = deviceList.find((d) => d.primary === true);
      if (primaryDevice) {
        saveSettings({
          uuid: primaryDevice.uuid,
          title: formatSpeakerTitle(primaryDevice.zoneName, primaryDevice.hostAddress),
          hostAddress: primaryDevice.hostAddress,
          zoneName: primaryDevice.zoneName,
        });
      }
    }
  } catch (err) {
    errorMessage.value = err?.message ?? String(err);
  } finally {
    isDiscovering.value = false;
  }
}

function onPresentationToggle(field, checked) {
  saveSettings({ [field]: checked });
}

function onPlayModeToggled(mode, checked) {
  const current = settings.value.selectedPlayModes ?? PLAY_MODES;
  const selectedSet = new Set(current);
  if (checked) {
    selectedSet.add(mode);
  } else {
    selectedSet.delete(mode);
  }
  const rebuilt = PLAY_MODES.filter((m) => selectedSet.has(m));
  saveSettings({ selectedPlayModes: rebuilt });
}

function onInputSourceToggled(source, checked) {
  const current = settings.value.selectedInputSources ?? INPUT_SOURCES;
  const selectedSet = new Set(current);
  if (checked) {
    selectedSet.add(source);
  } else {
    selectedSet.delete(source);
  }
  const rebuilt = INPUT_SOURCES.filter((s) => selectedSet.has(s));
  saveSettings({ selectedInputSources: rebuilt });
}

function onEqualizerTargetChanged(event) {
  saveSettings({ encoderAudioEqualizerTarget: event.target.value });
}

function onFavoriteSelected(event) {
  const option = event.target.selectedOptions[0];
  if (!option) return;
  const { title, metadata, albumArtUri } = option.dataset;
  const uri = event.target.value;
  saveSettings({
    selectedSonosFavorite: {
      title,
      uri,
      metadata,
      albumArtURI: albumArtUri,
    },
  });
}

const volumeIncrementOverride = computed({
  get() {
    if (settings.value.adjustVolumeIncrement == null) {
      return "";
    }
    return settings.value.adjustVolumeIncrement;
  },
  set(value) {
    if (value === "" || value == null) {
      saveSettings({ adjustVolumeIncrement: null });
    } else {
      saveSettings({ adjustVolumeIncrement: Number(value) });
    }
  },
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
  deviceTimeoutDuration,
  deviceCheckInterval,
  adjustVolumeIncrement,
  volumeIncrementOverride,
  saveAndConnect,
  onPresentationToggle,
  onPlayModeToggled,
  onInputSourceToggled,
  onEqualizerTargetChanged,
  onFavoriteSelected,
  bindings,
  currentSpeakerMissing,
  requestBindings,
  onReplaceSpeaker,
  onUndoReplacement,
  profilesFolderUrl,
  openProfilesFolder,
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
      <div
        v-if="settings.uuid && currentSpeakerMissing"
        class="alert alert-warning d-flex justify-content-between align-items-center py-2"
        role="status"
        data-pi-bound-speaker-alert
        data-pi-speaker-missing-alert
      >
        <small> {{ boundSpeakerLabel }}. <strong>Speaker not found in household.</strong> </small>
        <button type="button" class="btn btn-sm btn-outline-warning" data-pi-speaker-missing-fix @click="showSpeakerBindings">
          Fix
        </button>
      </div>
      <div v-else-if="settings.uuid" class="alert alert-light" role="status" data-pi-bound-speaker-alert>
        <small>{{ boundSpeakerLabel }}</small>
      </div>
    </section>

    <section v-if="showPresentationToggles" data-pi-section="presentation-toggles">
      <template v-if="showFavoriteToggles">
        <div v-for="t in FAVORITE_TOGGLES" :key="t.key" class="form-check form-switch">
          <input
            class="form-check-input"
            type="checkbox"
            :checked="settings[t.key] ?? false"
            :disabled="t.requires ? !settings[t.requires] : false"
            :data-pi-favorite-toggle="t.key"
            @change="onPresentationToggle(t.key, $event.target.checked)"
          />
          <label class="form-check-label">{{ t.label }}</label>
        </div>
        <div class="form-text text-muted" data-pi-favorite-toggle-hint>
          Track title, marquee and track artwork show only while this favorite is the one playing.
        </div>
      </template>
      <div v-if="showDisplayStateBasedTitle" class="form-check form-switch">
        <input
          class="form-check-input"
          type="checkbox"
          :checked="settings.displayStateBasedTitle ?? false"
          data-pi-toggle-state-based-title
          @change="onPresentationToggle('displayStateBasedTitle', $event.target.checked)"
        />
        <label class="form-check-label">Display State Based Title</label>
      </div>
      <div v-if="showDisplayMarqueeTitle" class="form-check form-switch">
        <input
          class="form-check-input"
          type="checkbox"
          :checked="settings.displayMarqueeTitle ?? false"
          data-pi-toggle-marquee-title
          @change="onPresentationToggle('displayMarqueeTitle', $event.target.checked)"
        />
        <label class="form-check-label">Display Marquee Title</label>
      </div>
      <div v-if="showDisplayMarqueeAlbumTitle" class="form-check form-switch">
        <input
          class="form-check-input"
          type="checkbox"
          :checked="settings.displayMarqueeAlbumTitle ?? false"
          data-pi-toggle-marquee-album-title
          @change="onPresentationToggle('displayMarqueeAlbumTitle', $event.target.checked)"
        />
        <label class="form-check-label">Display Marquee Album Title</label>
      </div>
      <div v-if="showDisplayAlbumArt" class="form-check form-switch">
        <input
          class="form-check-input"
          type="checkbox"
          :checked="settings.displayAlbumArt ?? false"
          data-pi-toggle-album-art
          @change="onPresentationToggle('displayAlbumArt', $event.target.checked)"
        />
        <label class="form-check-label">Display Album Art</label>
      </div>
    </section>

    <section v-if="shortName === 'toggle-play-mode'" data-pi-section="play-modes">
      <h1 class="h5">Play Mode(s)</h1>
      <div v-for="mode in PLAY_MODES" :key="mode" class="form-check form-switch">
        <input
          class="form-check-input"
          type="checkbox"
          :data-pi-play-mode="mode"
          :checked="(settings.selectedPlayModes ?? PLAY_MODES).includes(mode)"
          @change="onPlayModeToggled(mode, $event.target.checked)"
        />
        <label class="form-check-label">
          {{
            mode === "NORMAL"
              ? "Normal"
              : mode === "SHUFFLE_NOREPEAT"
                ? "Shuffle No Repeat"
                : mode === "SHUFFLE_REPEAT_ONE"
                  ? "Shuffle Repeat One"
                  : mode === "SHUFFLE"
                    ? "Shuffle"
                    : mode === "REPEAT_ONE"
                      ? "Repeat One"
                      : "Repeat All"
          }}
        </label>
      </div>
    </section>

    <section v-if="shortName === 'toggle-input-source'" data-pi-section="input-sources">
      <h1 class="h5">Input Source(s)</h1>
      <div v-for="source in INPUT_SOURCES" :key="source" class="form-check form-switch">
        <input
          class="form-check-input"
          type="checkbox"
          :data-pi-input-source="source"
          :checked="(settings.selectedInputSources ?? INPUT_SOURCES).includes(source)"
          @change="onInputSourceToggled(source, $event.target.checked)"
        />
        <label class="form-check-label">
          {{ source === "Sonos_Queue" ? "Sonos Queue" : source === "TV_Input" ? "Tv Input" : "Line In" }}
        </label>
      </div>
    </section>

    <section v-if="shortName === 'encoder-audio-equalizer'" data-pi-section="equalizer-target">
      <h1 class="h5">Equalizer Target</h1>
      <select
        class="form-select"
        :value="settings.encoderAudioEqualizerTarget ?? 'VOLUME'"
        data-pi-eq-target-select
        @change="onEqualizerTargetChanged"
      >
        <option value="VOLUME">Volume</option>
        <option value="BASS">Bass</option>
        <option value="TREBLE">Treble</option>
      </select>
    </section>

    <section v-if="shortName === 'play-sonos-favorite'" data-pi-section="sonos-favorites">
      <h1 class="h5">Sonos Favorite(s)</h1>
      <select
        class="form-select"
        :value="settings.selectedSonosFavorite?.uri ?? globalSettings.favorites?.[0]?.uri ?? ''"
        data-pi-favorite-select
        @change="onFavoriteSelected"
      >
        <option
          v-for="favorite in globalSettings.favorites ?? []"
          :key="favorite.uri"
          :value="favorite.uri"
          :data-title="favorite.title"
          :data-metadata="encodeFavoriteMetadata(favorite.metadata)"
          :data-album-art-uri="favorite.albumArtURI"
        >
          {{ favorite.title }}
        </option>
      </select>
    </section>

    <section v-if="shortName === 'volume-up' || shortName === 'volume-down'" data-pi-section="volume-increment-override">
      <h1 class="h5">Volume Increment</h1>
      <label class="form-label">Override increment (leave empty to use global default)</label>
      <input
        v-model="volumeIncrementOverride"
        type="number"
        min="1"
        class="form-control"
        data-pi-volume-increment-override
        :placeholder="`Global default: ${globalSettings.adjustVolumeIncrement ?? 10}`"
      />
      <div class="form-text text-muted">Volume range: 0–100</div>
    </section>

    <section data-pi-section="global-settings">
      <h1 class="h5">Global Settings</h1>
      <BootstrapAccordeon accordeon-id="global-settings-accordeon">
        <BootstrapAccordeonItem
          item-id="GlobalSettings"
          title="Global Settings"
          :force-expanded="!isConnected || forceGlobalsOpen"
        >
          <div v-if="errorMessage" class="alert alert-danger alert-dismissible fade show" role="alert" data-pi-error-alert>
            {{ errorMessage }}
            <button
              type="button"
              class="btn-close"
              aria-label="Close"
              data-pi-error-dismiss
              @click="errorMessage = ''"
            ></button>
          </div>
          <div class="mb-3">
            <label class="form-label">Primary Device Address (Discovery)</label>
            <input v-model="primaryDeviceAddress" type="text" class="form-control" data-pi-primary-device-address />
            <div class="form-text text-muted">Note: This device is used to discover all other devices on the network</div>
          </div>
          <div class="mb-3">
            <label class="form-label">Device Timeout Duration (Actions)</label>
            <input v-model="deviceTimeoutDuration" type="number" min="1" class="form-control" data-pi-device-timeout-duration />
            <div class="form-text text-muted">Note: This timeout is used when executing device actions (in seconds)</div>
          </div>
          <div class="mb-3">
            <label class="form-label">Device Check Interval (Actions)</label>
            <input v-model="deviceCheckInterval" type="number" min="1" class="form-control" data-pi-device-check-interval />
            <div class="form-text text-muted">
              Note: This interval is used to check the status of the device selected for this action (in seconds)
            </div>
          </div>
          <div class="mb-3">
            <label class="form-label">Volume Increment (Up/Down)</label>
            <input v-model="adjustVolumeIncrement" type="number" min="1" class="form-control" data-pi-global-volume-increment />
            <div class="form-text text-muted">
              Note: Volume range is 0–100. Used by Volume Up and Volume Down actions unless overridden per-button.
            </div>
          </div>
          <div class="d-flex justify-content-end">
            <button
              type="button"
              class="btn btn-primary"
              data-pi-save-and-connect
              :disabled="!primaryDeviceAddress.trim() || isDiscovering"
              @click="saveAndConnect"
            >
              <span
                v-if="isDiscovering"
                class="spinner-border spinner-border-sm"
                role="status"
                aria-hidden="true"
                data-pi-save-and-connect-spinner
              ></span>
              {{ isConnected ? "Save and Reconnect" : "Save and Connect" }}
            </button>
          </div>

          <hr class="my-4" />
          <div ref="bindingsSection">
            <SpeakerBindings
              :bindings="bindings"
              :globals="globalSettings"
              @replace="onReplaceSpeaker"
              @undo="onUndoReplacement"
            />
          </div>

          <template v-if="profilesFolderUrl">
            <hr class="my-4" />
            <div data-pi-advanced>
              <h2 class="h6 mb-1">Advanced</h2>
              <button type="button" class="btn btn-link btn-sm px-0" data-pi-open-profiles @click="openProfilesFolder">
                Open Stream Deck profiles folder…
              </button>
              <div class="form-text text-warning">
                Quit Stream Deck from the tray before editing profile files. It overwrites them while running.
              </div>
            </div>
          </template>
        </BootstrapAccordeonItem>
      </BootstrapAccordeon>
    </section>
  </div>
</template>
