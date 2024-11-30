<template>
  <div class="container-fluid">
    <div v-if="sonosConnectionState === OPERATIONAL_STATUS.CONNECTED" class="clearfix mb-3">
      <h1>Sonos Speakers</h1>

      <AccordeonComponent id="presses" class="mb-2">
        <AccordeonItem accordeon-id="presses" item-id="availableSonosSpeakers" title="Available Sonos Speakers">
          <SonosSelection
            class="mb-3"
            :available-sonos-speakers="availableSonosSpeakers"
            v-model="sonosSpeaker"
            @selection-saved="saveSettings"
          ></SonosSelection>
        </AccordeonItem>
      </AccordeonComponent>
      <div class="alert alert-light" v-if="selectedSonosSpeaker">
        <center>{{ selectedSonosSpeaker.title }}</center>
      </div>

      <div class="form-check form-switch" v-if="displayStateBasedTitleFor.includes(actionName)">
        <input
          id="chkButtonTitle"
          v-model="displayStateBasedTitle"
          class="form-check-input"
          type="checkbox"
          @change="saveSettings"
        />
        <label class="form-check-label" for="chkButtonTitle">Display State Based Title</label>
      </div>
      <div class="form-check form-switch" v-if="displayMarqueeTitleFor.includes(actionName)">
        <input
          id="chkButtonMarqueeTitle"
          v-model="displayMarqueeTitle"
          class="form-check-input"
          type="checkbox"
          @change="saveSettings"
        />
        <label class="form-check-label" for="chkButtonMarqueeTitle">Display Marquee Title</label>
      </div>
      <div class="form-check form-switch" v-if="displayMarqueeAlbumTitleFor.includes(actionName)">
        <input
          id="chkButtonAlbumTitle"
          v-model="displayMarqueeAlbumTitle"
          class="form-check-input"
          type="checkbox"
          @change="saveSettings"
        />
        <label class="form-check-label" for="chkButtonAlbumTitle">Display Marquee Album Title</label>
      </div>
      <div class="form-check form-switch" v-if="displayAlbumArtFor.includes(actionName)">
        <input
          id="chkButtonAlbumArt"
          v-model="displayAlbumArt"
          class="form-check-input"
          type="checkbox"
          @change="saveSettings"
        />
        <label class="form-check-label" for="chkButtonAlbumArt">Display Album Art</label>
      </div>
    </div>

    <div v-if="sonosConnectionState === OPERATIONAL_STATUS.CONNECTED && isTogglePlayMode">
      <h1>Play Mode(s)</h1>
      <div class="d-flex flex-column gap-2 mb-3">
        <div v-for="option in availablePlayModes" :key="option.value" class="form-check form-switch">
          <input
            type="checkbox"
            class="form-check-input"
            :id="option.value"
            :value="option.value"
            v-model="selectedPlayModes"
            @change="saveSettings"
          />
          <label class="form-check-label" :for="option.value">
            {{ option.label }}
          </label>
        </div>
      </div>
    </div>

    <div v-if="sonosConnectionState === OPERATIONAL_STATUS.CONNECTED && isToggleInputSource">
      <h1>Input Source(s)</h1>
      <div class="d-flex flex-column gap-2 mb-3">
        <div v-for="option in availableInputSources" :key="option.value" class="form-check form-switch">
          <input
            type="checkbox"
            class="form-check-input"
            :id="option.value"
            :value="option.value"
            v-model="selectedInputSources"
            @change="saveSettings"
          />
          <label class="form-check-label" :for="option.value">
            {{ option.label }}
          </label>
        </div>
      </div>
    </div>

    <div v-if="sonosConnectionState === OPERATIONAL_STATUS.CONNECTED && isEncoderAudioEqualizer">
      <h1>Equalizer Target</h1>
      <div class="d-flex flex-column gap-2 mb-3">
        <select
          id="encoderAudioEqualizerTarget"
          v-model="encoderAudioEqualizerTarget"
          class="form-select form-select-sm"
          @change="saveSettings"
        >
          <option v-for="option in availableEqualizerTargets" :key="option" :value="option.toUpperCase()">
            {{ option.charAt(0).toUpperCase() + option.slice(1).toLowerCase() }}
          </option>
        </select>
      </div>
    </div>

    <div v-if="sonosConnectionState === OPERATIONAL_STATUS.CONNECTED && isPlaySonosFavorite">
      <h1>Sonos Favorite(s)</h1>
      <div class="d-flex flex-column gap-2 mb-3">
        <select class="form-select form-select-sm" v-model="sonosFavorite" @change="saveSettings">
          <option
            v-for="option in availableSonosFavorites"
            :key="option.value"
            :value="option.value"
            :metadata="option.metadata"
          >
            {{ option.title }}
          </option>
        </select>
      </div>
    </div>

    <div class="clearfix mb-3">
      <h1>Global Settings</h1>
      <AccordeonComponent id="globalSettings" class="mb-2">
        <AccordeonItem
          accordeon-id="globalSettings"
          item-id="globalSettings"
          title="Global Settings"
          :force-expanded="sonosConnectionState !== OPERATIONAL_STATUS.CONNECTED"
        >
          <div class="mb-3">
            <label class="form-label" for="primaryDeviceAddress">Primary Device Address (Discovery)</label>
            <small class="text-muted d-block">Note: This device is used to discover all other devices on the network</small>
            <input id="primaryDeviceAddress" v-model="primaryDeviceAddress" class="form-control form-control-sm" type="text" />
            <label class="form-label" for="TESTdeviceTimeoutDuration">Device Timeout Duration (Actions)</label>
            <small class="text-muted d-block">Note: This timeout is used when executing device actions (in seconds)</small>
            <input
              id="deviceTimeoutDuration"
              v-model="deviceTimeoutDuration"
              class="form-control form-control-sm"
              type="number"
            />
            <label class="form-label" for="deviceCheckInterval">Device Check Interval (Actions)</label>
            <small class="text-muted d-block"
              >Note: This interval is used to check the status of the device selected for this action (in seconds)</small
            >
            <input id="deviceCheckInterval" v-model="deviceCheckInterval" class="form-control form-control-sm" type="number" />
          </div>

          <div v-if="sonosError" class="alert alert-danger alert-dismissible" role="alert">
            {{ sonosError }}
            <button class="btn-close" type="button" @click="sonosError = ''"></button>
          </div>
        </AccordeonItem>
      </AccordeonComponent>
      <button
        :disabled="!isSonosSettingsComplete || sonosConnectionState === OPERATIONAL_STATUS.CONNECTING"
        class="btn btn-sm btn-primary float-end"
        v-on:click="saveGlobalSettings"
      >
        <span
          v-if="sonosConnectionState === OPERATIONAL_STATUS.CONNECTING"
          aria-hidden="true"
          class="spinner-border spinner-border-sm"
          role="status"
        ></span>
        <span>{{ sonosConnectionState === OPERATIONAL_STATUS.CONNECTED ? "Save and Reconnect" : "Save and Connect" }}</span>
      </button>
    </div>
  </div>
</template>

<script setup>
import AccordeonComponent from "@/components/accordeon/BootstrapAccordeon.vue";
import AccordeonItem from "@/components/accordeon/BootstrapAccordeonItem.vue";
import { SonosController } from "@/modules/common/sonosController";
import { OPERATIONAL_STATUS } from "@/modules/plugin/SonosSpeakers";
import { SonosSpeaker } from "@/modules/pi/SonosSpeaker";
import { StreamDeck } from "@/modules/common/streamdeck";
import { computed, onMounted, ref } from "vue";
import { Buffer } from "buffer";
import SonosSelection from "@/components/SonosSelection.vue";
import manifest from "@manifest";

const streamDeckConnection = ref(null);
const sonosError = ref("");
const primaryDeviceAddress = ref("");
const deviceCheckInterval = ref(10);
const deviceTimeoutDuration = ref(5);
const sonosConnectionState = ref(OPERATIONAL_STATUS.DISCONNECTED);
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

const displayStateBasedTitleFor = [
  "toggle-play-mode",
  "toggle-input-source",
  "toggle-play-pause",
  "toggle-mute-unmute",
  "volume-up",
  "volume-down",
  "play-previous-track",
  "play-next-track",
];
const displayStateBasedTitle = ref(false);

const displayAlbumArtFor = ["toggle-play-pause", "play-sonos-favorite", "currently-playing"];
const displayAlbumArt = ref(false);

const displayMarqueeTitleFor = ["play-sonos-favorite", "currently-playing"];
const displayMarqueeTitle = ref(false);

const displayMarqueeAlbumTitleFor = ["toggle-play-pause", "currently-playing"];
const displayMarqueeAlbumTitle = ref(false);

const isEncoderAudioEqualizer = ref(false);
const availableEqualizerTargets = ref(["volume", "bass", "treble"]);
const encoderAudioEqualizerTarget = ref("");

onMounted(() => {
  window.connectElgatoStreamDeckSocket = (exPort, exPropertyInspectorUUID, exRegisterEvent, exInfo, exActionInfo) => {
    streamDeckConnection.value = new StreamDeck(exPort, exPropertyInspectorUUID, exRegisterEvent, exInfo, exActionInfo);
    const exActionInfoObject = JSON.parse(exActionInfo);
    actionName.value = exActionInfoObject.action.split(".").pop();
    manifestAction.value = manifest.Actions.find((manifestAction) => manifestAction.UUID === exActionInfoObject.action);

    action.value = exActionInfoObject.action;
    controllerType.value = exActionInfoObject.payload.controller;

    streamDeckConnection.value.on("connected", () => {
      streamDeckConnection.value.requestGlobalSettings();
    });

    // this is called when the user clicks the save button external from the pi
    // saving in case logic is needed in the future
    // streamDeckConnection.value.on("didReceiveSettings", (inMessage) => {
    //   actionSettings.value = inMessage.payload.settings;
    // });
    // streamDeckConnection.value.on("sendToPropertyInspector", (inMessage) => {
    //   console.log(inMessage);
    // });

    streamDeckConnection.value.on("globalsettings", (inGlobalSettings) => {
      if (inGlobalSettings) {
        if (inGlobalSettings.devices) {
          deviceCheckInterval.value = inGlobalSettings.deviceCheckInterval;
          deviceTimeoutDuration.value = inGlobalSettings.deviceTimeoutDuration;
          const primaryDevice = Object.values(inGlobalSettings.devices).find((device) => device.primary === true);
          if (primaryDevice) {
            primaryDeviceAddress.value = primaryDevice.hostAddress;
            actionSettings.value = JSON.parse(exActionInfo).payload.settings;

            sonosConnectionState.value = OPERATIONAL_STATUS.CONNECTED;
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
                  albumArtURI: favorite.albumArtURI,
                }));
                if (actionSettings.value?.selectedSonosFavorite) {
                  sonosFavorite.value = actionSettings.value.selectedSonosFavorite.uri;
                } else {
                  sonosFavorite.value = availableSonosFavorites.value[0].value;
                }
                break;
            }

            displayStateBasedTitle.value = actionSettings.value?.displayStateBasedTitle ?? false;
            displayAlbumArt.value = actionSettings.value?.displayAlbumArt ?? false;
            displayMarqueeTitle.value = actionSettings.value?.displayMarqueeTitle ?? false;
            displayMarqueeAlbumTitle.value = actionSettings.value?.displayMarqueeAlbumTitle ?? false;

            refreshAvailableSonosSpeakers({
              inDevices: inGlobalSettings.devices,
              inActionSettings: actionSettings.value,
              triggerSaveSettings: !actionSettings.value || Object.keys(actionSettings.value).length === 0,
            });
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
const selectedSonosFavorite = computed(() =>
  availableSonosFavorites.value.find((favorite) => favorite.value === sonosFavorite.value),
);
const selectedSonosSpeaker = computed(() =>
  availableSonosSpeakers.value.find((speaker) => speaker.uuid === sonosSpeaker.value),
);

function refreshAvailableSonosSpeakers({ inDevices, inActionSettings = {}, triggerSaveSettings = true }) {
  availableSonosSpeakers.value = Object.values(inDevices)
    .map(
      (device) =>
        new SonosSpeaker({
          zoneName: device.zoneName,
          hostAddress: device.hostAddress,
          uuid: device.uuid,
          isSatellite: device.isSatellite,
        }),
    )
    .sort((a, b) =>
      a.title.toLowerCase() > b.title.toLowerCase() ? 1 : b.title.toLowerCase() > a.title.toLowerCase() ? -1 : 0,
    );

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
  sonosConnectionState.value = OPERATIONAL_STATUS.CONNECTING;
  const $SONOS = new SonosController();
  $SONOS.connect(primaryDeviceAddress.value);

  try {
    const timeout = (sonosAction) =>
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`Timeout while ${sonosAction} after ${deviceTimeoutDuration.value} seconds`)),
          deviceTimeoutDuration.value * 1000,
        ),
      );
    const getDevices = await Promise.race([$SONOS.getDevices({ setAsPrimary: true }), timeout("getting devices")]);
    if (!getDevices.timedOut) {
      clearTimeout(getDevices.timedOut);
    }
    const getFavorites = await Promise.race([$SONOS.getFavorites(), timeout("getting favorites")]);
    if (!getFavorites.timedOut) {
      clearTimeout(getFavorites.timedOut);
    }
    sonosConnectionState.value = OPERATIONAL_STATUS.CONNECTED;
    refreshAvailableSonosSpeakers({
      inDevices: getDevices.list,
      inActionSettings: actionSettings.value,
    });
    streamDeckConnection.value.saveGlobalSettings({
      payload: {
        devices: getDevices.list,
        deviceCheckInterval: deviceCheckInterval.value,
        deviceTimeoutDuration: deviceTimeoutDuration.value,
        favorites: getFavorites.list,
      },
    });
  } catch (error) {
    sonosConnectionState.value = OPERATIONAL_STATUS.DISCONNECTED;
    console.error("Failed to get devices:", error.message);
    sonosError.value = `Failed to get devices: ${error.message}`;
  }
}

function saveSettings() {
  actionSettings.value = {
    action: action.value,
    states: manifestAction.value.States,
    controller: controllerType.value,
    uuid: selectedSonosSpeaker.value.uuid,
    title: selectedSonosSpeaker.value.title,
    hostAddress: selectedSonosSpeaker.value.hostAddress,
    zoneName: selectedSonosSpeaker.value.zoneName,
    selectedPlayModes: selectedPlayModes.value || [],
    selectedInputSources: selectedInputSources.value || [],
    encoderAudioEqualizerTarget: encoderAudioEqualizerTarget.value,
    displayStateBasedTitle: displayStateBasedTitleFor.includes(actionName.value) ? displayStateBasedTitle.value : null,
    displayAlbumArt: displayAlbumArtFor.includes(actionName.value) ? displayAlbumArt.value : null,
    displayMarqueeTitle: displayMarqueeTitleFor.includes(actionName.value) ? displayMarqueeTitle.value : null,
    displayMarqueeAlbumTitle: displayMarqueeAlbumTitleFor.includes(actionName.value) ? displayMarqueeAlbumTitle.value : null,
    selectedSonosFavorite: selectedSonosFavorite.value
      ? {
          title: selectedSonosFavorite.value.title,
          uri: selectedSonosFavorite.value.value,
          metadata: Buffer.from(selectedSonosFavorite.value.metadata, "base64").toString("utf-8"),
          albumArtURI: selectedSonosFavorite.value.albumArtURI,
        }
      : null,
  };
  streamDeckConnection.value.saveSettings({
    actionSettings: actionSettings.value,
  });
}
</script>
