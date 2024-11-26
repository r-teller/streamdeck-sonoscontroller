<template>
  <div class="container-fluid">
    <div v-if="sonosConnectionState === CONNECTION_STATES.CONNECTED" class="clearfix mb-3">
      <h1>Sonos Speakers</h1>
      <SonosSelection class="mb-3" :available-sonos-speakers="availableSonosSpeakers" v-model="sonosSpeaker" @selection-saved="saveSettings"></SonosSelection>

      <div class="form-check form-switch" v-if="displayStateBasedTitleFor.includes(actionName)">
        <input id="chkButtonTitle" v-model="displayStateBasedTitle" class="form-check-input" type="checkbox" @change="saveSettings" />
        <label class="form-check-label" for="chkButtonTitle">Display State Based Title</label>
      </div>
      <div class="form-check form-switch" v-if="displayMarqueeTitleFor.includes(actionName)">
        <input id="chkButtonMarqueeTitle" v-model="displayMarqueeTitle" class="form-check-input" type="checkbox" @change="saveSettings" />
        <label class="form-check-label" for="chkButtonMarqueeTitle">Display Marquee Title</label>
      </div>
      <div class="form-check form-switch" v-if="displayMarqueeAlbumTitleFor.includes(actionName)">
        <input id="chkButtonAlbumTitle" v-model="displayMarqueeAlbumTitle" class="form-check-input" type="checkbox" @change="saveSettings" />
        <label class="form-check-label" for="chkButtonAlbumTitle">Display Marquee Album Title</label>
      </div>
      <div class="form-check form-switch" v-if="displayAlbumArtFor.includes(actionName)">
        <input id="chkButtonAlbumArt" v-model="displayAlbumArt" class="form-check-input" type="checkbox" @change="saveSettings" />
        <label class="form-check-label" for="chkButtonAlbumArt">Display Album Art</label>
      </div>
    </div>

    <div v-if="sonosConnectionState === CONNECTION_STATES.CONNECTED && isTogglePlayMode">
      <h1>Play Mode(s)</h1>
      <div class="d-flex flex-column gap-2 mb-3">
        <div v-for="option in availablePlayModes" :key="option.value" class="form-check form-switch">
          <input type="checkbox" class="form-check-input" :id="option.value" :value="option.value" v-model="selectedPlayModes" @change="saveSettings" />
          <label class="form-check-label" :for="option.value">
            {{ option.label }}
          </label>
        </div>
      </div>
    </div>

    <div v-if="sonosConnectionState === CONNECTION_STATES.CONNECTED && isToggleInputSource">
      <h1>Input Source(s)</h1>
      <div class="d-flex flex-column gap-2 mb-3">
        <div v-for="option in availableInputSources" :key="option.value" class="form-check form-switch">
          <input type="checkbox" class="form-check-input" :id="option.value" :value="option.value" v-model="selectedInputSources" @change="saveSettings" />
          <label class="form-check-label" :for="option.value">
            {{ option.label }}
          </label>
        </div>
      </div>
    </div>

    <div v-if="sonosConnectionState === CONNECTION_STATES.CONNECTED && isEncoderAudioEqualizer">
      <!-- <label class="form-label" for="encoderAudioEqualizerTarget">Equalizer Target</label> -->
      <!-- <div class="input-group"> -->
      <h1>Equalizer Target</h1>
      <div class="d-flex flex-column gap-2 mb-3">
        <select id="encoderAudioEqualizerTarget" v-model="encoderAudioEqualizerTarget" class="form-select form-select-sm" @change="saveSettings">
          <option v-for="option in availableEqualizerTargets" :key="option" :value="option.toUpperCase()">
            {{ option.charAt(0).toUpperCase() + option.slice(1).toLowerCase() }}
          </option>
        </select>
      </div>
    </div>

    <div v-if="sonosConnectionState === CONNECTION_STATES.CONNECTED && isPlaySonosFavorite">
      <h1>Sonos Favorite(s)</h1>
      <div class="d-flex flex-column gap-2 mb-3">
        <select class="form-select form-select-sm" v-model="sonosFavorite" @change="saveSettings">
          <option v-for="option in availableSonosFavorites" :key="option.value" :value="option.value" :metadata="option.metadata">
            {{ option.title }}
          </option>
        </select>
      </div>
    </div>

    <div class="clearfix mb-3">
      <h1>Global Settings</h1>
      <div class="mb-3">
        <label class="form-label" for="primaryDeviceAddress">Primary Device Address (Discovery)</label>
        <small class="text-muted d-block">Note: This device is used to discover all other devices on the network</small>
        <input id="primaryDeviceAddress" v-model="primaryDeviceAddress" class="form-control form-control-sm" type="text" />
        <label class="form-label" for="TESTdeviceTimeoutDuration">Device Timeout Duration (Actions)</label>
        <small class="text-muted d-block">Note: This timeout is used when executing device actions (in seconds)</small>
        <input id="deviceTimeoutDuration" v-model="deviceTimeoutDuration" class="form-control form-control-sm" type="number" />
        <label class="form-label" for="deviceCheckInterval">Device Check Interval (Actions)</label>
        <small class="text-muted d-block">Note: This interval is used to check the status of the device selected for this action (in seconds)</small>
        <input id="deviceCheckInterval" v-model="deviceCheckInterval" class="form-control form-control-sm" type="number" />
      </div>

      <div v-if="sonosError" class="alert alert-danger alert-dismissible" role="alert">
        {{ sonosError }}
        <button class="btn-close" type="button" @click="sonosError = ''"></button>
      </div>

      <button :disabled="!isSonosSettingsComplete || sonosConnectionState === 'connecting'" class="btn btn-sm btn-primary float-end" v-on:click="saveGlobalSettings">
        <span v-if="sonosConnectionState === 'connecting'" aria-hidden="true" class="spinner-border spinner-border-sm" role="status"></span>
        <span>{{ sonosConnectionState === "connected" ? "Save and Reconnect" : "Save and Connect" }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import { SonosController } from "@/modules/common/sonosController";
import { SonosSpeaker } from "@/modules/pi/SonosSpeaker";
import { StreamDeck } from "@/modules/common/streamdeck";
import { computed, onMounted, ref } from "vue";
import { Buffer } from "buffer";
import SonosSelection from "@/components/SonosSelection.vue";
import manifest from "@manifest";

const CONNECTION_STATES = {
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  CONNECTING: "connecting",
};

let $SD = null;
const sonosError = ref("");
const primaryDeviceAddress = ref("");
const deviceCheckInterval = ref(10);
const deviceTimeoutDuration = ref(5);
const sonosConnectionState = ref("disconnected");
const availableSonosSpeakers = ref([]);
const actionSettings = ref({});

// Stores selected sonos speaker UUID
const sonosSpeaker = ref("");

// Stores streamdeck action UUID and controller type
const action = ref("");
const actionName = ref("");
const controllerType = ref("");
const manifestAction = ref({});

const isPlaySonosFavorite = ref(false);
const availableSonosFavorites = ref([]);
const sonosFavorite = ref("");

const isTogglePlayMode = ref(false);
const selectedPlayModes = ref([]);
const availablePlayModes = ref([]);

const isToggleInputSource = ref(false);
const availableInputSources = ref([]);
const selectedInputSources = ref([]);

const displayStateBasedTitleFor = ["toggle-play-mode", "toggle-input-source", "toggle-play-pause", "toggle-mute-unmute", "volume-up", "volume-down", "play-previous-track", "play-next-track"];
const displayStateBasedTitle = ref(false);

const displayAlbumArtFor = ["toggle-play-pause", "play-sonos-favorite"];
const displayAlbumArt = ref(false);

const displayMarqueeTitleFor = ["play-sonos-favorite"];
const displayMarqueeTitle = ref(false);

const displayMarqueeAlbumTitleFor = ["play-sonos-favorite", "toggle-play-pause"];
const displayMarqueeAlbumTitle = ref(false);

const isEncoderAudioEqualizer = ref(false);
const availableEqualizerTargets = ref(["volume", "bass", "treble"]);
const encoderAudioEqualizerTarget = ref("");

onMounted(() => {
  window.connectElgatoStreamDeckSocket = (exPort, exPropertyInspectorUUID, exRegisterEvent, exInfo, exActionInfo) => {
    $SD = new StreamDeck(exPort, exPropertyInspectorUUID, exRegisterEvent, exInfo, exActionInfo);
    const exActionInfoObject = JSON.parse(exActionInfo);
    actionName.value = exActionInfoObject.action.split(".").pop();
    manifestAction.value = manifest.Actions.find((manifestAction) => manifestAction.UUID === exActionInfoObject.action);

    action.value = exActionInfoObject.action;
    controllerType.value = exActionInfoObject.payload.controller;

    $SD.on("connected", () => {
      $SD.requestGlobalSettings();
    });

    $SD.on("globalsettings", (inGlobalSettings) => {
      if (inGlobalSettings) {
        if (inGlobalSettings.devices) {
          deviceCheckInterval.value = inGlobalSettings.deviceCheckInterval;
          deviceTimeoutDuration.value = inGlobalSettings.deviceTimeoutDuration;
          const primaryDevice = Object.values(inGlobalSettings.devices).find((device) => device.primary === true);
          if (primaryDevice) {
            console.log("primaryDevice", primaryDevice);
            primaryDeviceAddress.value = primaryDevice.hostAddress;
            actionSettings.value = JSON.parse(exActionInfo).payload.settings;

            sonosConnectionState.value = CONNECTION_STATES.CONNECTED;
            switch (actionName.value) {
              case "toggle-play-mode":
                isTogglePlayMode.value = true;
                availablePlayModes.value = manifestAction.value.States.map((state) => ({
                  value: state.Name.toUpperCase(),
                  label: state.Name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
                }));
                if (actionSettings.value?.selectedPlayModes) {
                  selectedPlayModes.value = actionSettings.value.selectedPlayModes;
                } else {
                  selectedPlayModes.value = availablePlayModes.value.map((playMode) => playMode.value);
                }
                break;
              case "toggle-input-source":
                isToggleInputSource.value = true;
                availableInputSources.value = manifestAction.value.States.map((state) => ({
                  value: state.Name.toUpperCase(),
                  label: state.Name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
                }));
                if (actionSettings.value?.selectedInputSources) {
                  selectedInputSources.value = actionSettings.value.selectedInputSources;
                } else {
                  selectedInputSources.value = availableInputSources.value.map((inputSource) => inputSource.value);
                }
                break;
              case "encoder-audio-equalizer":
                isEncoderAudioEqualizer.value = true;
                if (actionSettings.value?.encoderAudioEqualizerTarget) {
                  encoderAudioEqualizerTarget.value = actionSettings.value.encoderAudioEqualizerTarget;
                } else {
                  encoderAudioEqualizerTarget.value = "VOLUME";
                }
                break;
              case "play-sonos-favorite":
                isPlaySonosFavorite.value = true;
                availableSonosFavorites.value = inGlobalSettings.favorites.map((favorite) => ({
                  title: favorite.title,
                  metadata: Buffer.from(favorite.metadata, "utf-8").toString("base64"),
                  value: favorite.uri,
                }));
                if (actionSettings.value?.selectedSonosFavorite) {
                  sonosFavorite.value = actionSettings.value.selectedSonosFavorite.uri;
                } else {
                  sonosFavorite.value = availableSonosFavorites.value[0].value;
                }
                break;
            }

            if (actionSettings.value?.displayStateBasedTitle) {
              displayStateBasedTitle.value = actionSettings.value.displayStateBasedTitle;
            } else {
              displayStateBasedTitle.value = false;
            }

            if (actionSettings.value?.displayAlbumArt) {
              displayAlbumArt.value = actionSettings.value.displayAlbumArt;
            } else {
              displayAlbumArt.value = false;
            }

            if (actionSettings.value?.displayMarqueeTitle) {
              displayMarqueeTitle.value = actionSettings.value.displayMarqueeTitle;
            } else {
              displayMarqueeTitle.value = false;
            }

            if (actionSettings.value?.displayMarqueeAlbumTitle) {
              displayMarqueeAlbumTitle.value = actionSettings.value.displayMarqueeAlbumTitle;
            } else {
              displayMarqueeAlbumTitle.value = false;
            }

            refreshAvailableSonosSpeakers({
              inDevices: inGlobalSettings.devices,
              inActionSettings: actionSettings.value,
              triggerSaveSettings: !actionSettings.value || Object.keys(actionSettings.value).length === 0,
            });
            console.log("Primary Device set to:", primaryDevice);
          } else {
            console.log("No primary device found");
          }
        }
      }
    });
  };
});

const isSonosSettingsComplete = computed(() => {
  return primaryDeviceAddress.value;
});

function refreshAvailableSonosSpeakers({ inDevices, inActionSettings = {}, triggerSaveSettings = true }) {
  availableSonosSpeakers.value = Object.values(inDevices)
    .map(
      (device) =>
        new SonosSpeaker({
          zoneName: device.zoneName,
          hostAddress: device.hostAddress,
          uuid: device.uuid,
          isSatellite: device.isSatellite,
        })
    )
    .sort((a, b) => (a.title.toLowerCase() > b.title.toLowerCase() ? 1 : b.title.toLowerCase() > a.title.toLowerCase() ? -1 : 0));
  // .sort((a, b) => a.title.localeCompare(b.title));

  if (inActionSettings?.uuid) {
    sonosSpeaker.value = inActionSettings.uuid;
    if (triggerSaveSettings) {
      saveSettings();
    }
  } else {
    const primaryDevice = Object.values(inDevices).find((device) => device.primary === true).uuid;
    sonosSpeaker.value = primaryDevice;
    if (triggerSaveSettings) {
      saveSettings();
    }
  }
}

async function saveGlobalSettings() {
  sonosError.value = "";
  sonosConnectionState.value = CONNECTION_STATES.CONNECTING;
  const $SONOS = new SonosController();
  $SONOS.connect(primaryDeviceAddress.value);

  try {
    const timeout = (sonosAction) => new Promise((_, reject) => setTimeout(() => reject(new Error(`Timeout while ${sonosAction} after ${deviceTimeoutDuration.value} seconds`)), deviceTimeoutDuration.value * 1000));
    const devices = await Promise.race([$SONOS.getDevices({ setAsPrimary: true }), timeout("getting devices")]);
    if (!devices.timedOut) {
      clearTimeout(devices.timedOut);
    }
    const favorites = await Promise.race([$SONOS.getFavorites(), timeout("getting favorites")]);
    if (!favorites.timedOut) {
      clearTimeout(favorites.timedOut);
    }
    sonosConnectionState.value = CONNECTION_STATES.CONNECTED;
    refreshAvailableSonosSpeakers({ inDevices: devices, inActionSettings: actionSettings.value });
    $SD.saveGlobalSettings({ payload: { devices, deviceCheckInterval: deviceCheckInterval.value, deviceTimeoutDuration: deviceTimeoutDuration.value, favorites: favorites.list } });
  } catch (error) {
    sonosConnectionState.value = CONNECTION_STATES.DISCONNECTED;
    console.error("Failed to get devices:", error.message);
    sonosError.value = `Failed to get devices: ${error.message}`;
  }
}

function saveSettings() {
  const selectedSonosSpeaker = availableSonosSpeakers.value.find((selectedSonosSpeaker) => selectedSonosSpeaker.uuid === sonosSpeaker.value);
  const selectedSonosFavorite = availableSonosFavorites.value.find((favorite) => favorite.value === sonosFavorite.value);
  actionSettings.value = {
    action: action.value,
    states: manifestAction.value.States,
    controller: controllerType.value,
    uuid: selectedSonosSpeaker.uuid,
    title: selectedSonosSpeaker.title,
    hostAddress: selectedSonosSpeaker.hostAddress,
    zoneName: selectedSonosSpeaker.zoneName,
    selectedPlayModes: selectedPlayModes.value || [],
    selectedInputSources: selectedInputSources.value || [],
    encoderAudioEqualizerTarget: encoderAudioEqualizerTarget.value,
    displayStateBasedTitle: displayStateBasedTitleFor.includes(actionName.value) ? displayStateBasedTitle.value : null,
    displayAlbumArt: displayAlbumArtFor.includes(actionName.value) ? displayAlbumArt.value : null,
    displayMarqueeTitle: displayMarqueeTitleFor.includes(actionName.value) ? displayMarqueeTitle.value : null,
    displayMarqueeAlbumTitle: displayMarqueeAlbumTitleFor.includes(actionName.value) ? displayMarqueeAlbumTitle.value : null,
    selectedSonosFavorite: selectedSonosFavorite
      ? {
          title: selectedSonosFavorite.title,
          uri: selectedSonosFavorite.value,
          metadata: Buffer.from(selectedSonosFavorite.metadata, "base64").toString("utf-8"),
        }
      : null,
  };
  console.log("actionSettings.value", actionSettings.value);
  $SD.saveSettings({ actionSettings: actionSettings.value });
}
</script>
