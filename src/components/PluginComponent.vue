<template>
  <span>Nothing to see here Plv4!</span>
</template>

<script setup>
import { StreamDeck } from "@/modules/common/streamdeck";

import { SonosController } from "@/modules/common/sonosController";
import { sonosControllerActions } from "@/modules/actions/sonosController";
import SonosSpeakers from "@/modules/plugin/SonosSpeakers";
import { onMounted, ref } from "vue";

const $SD = ref(null);

const globalSettings = ref({});
const actionSettings = ref([]);

const deviceCheckInterval = ref(10);
const deviceTimeoutDuration = ref(5);

let rotationTimeout = [];
let rotationAmount = [];
let rotationPercent = [];

const actionFunctionMap = {
  "toggle-mute-unmute": {
    keyDown: [sonosControllerActions.toggleMuteUnmute.action],
    state: {
      default: sonosControllerActions.toggleMuteUnmute.state.default,
      keypad: null,
      encoder: null,
    },
  },
  "toggle-play-pause": {
    keyDown: [sonosControllerActions.togglePlayPause.action],
    state: {
      default: sonosControllerActions.togglePlayPause.state.default,
      keypad: null,
      encoder: null,
    },
  },

  "toggle-play-mode": {
    keyDown: [sonosControllerActions.togglePlayMode.action],
    state: {
      default: sonosControllerActions.togglePlayMode.state.default,
      keypad: null,
      encoder: null,
    },
  },
  "toggle-input-source": {
    keyDown: [sonosControllerActions.toggleInputSource.action],
    state: {
      default: sonosControllerActions.toggleInputSource.state.default,
      keypad: null,
      encoder: null,
    },
  },
  "play-next-track": {
    keyDown: [sonosControllerActions.playNextTrack.action],
    state: {
      keypad: sonosControllerActions.playNextTrack.state.keypad,
    },
  },
  "play-previous-track": {
    keyDown: [sonosControllerActions.playPreviousTrack.action],
    state: {
      keypad: sonosControllerActions.playPreviousTrack.state.keypad,
    },
  },
  "play-sonos-favorite": {
    keyDown: [sonosControllerActions.playSonosFavorite.action],
    state: {
      default: sonosControllerActions.playSonosFavorite.state.default,
      keypad: null,
      encoder: null,
    },
  },
  "volume-up": {
    keyDown: [sonosControllerActions.volumeUp.action],
    state: {
      keypad: sonosControllerActions.volumeUp.state.keypad,
    },
  },
  "volume-down": {
    keyDown: [sonosControllerActions.volumeDown.action],
    state: {
      keypad: sonosControllerActions.volumeDown.state.keypad,
    },
  },
  "encoder-audio-equalizer": {
    dialRotate: [sonosControllerActions.encoderAudioEqualizer.action],
    state: {
      encoder: sonosControllerActions.encoderAudioEqualizer.state.encoder,
    },
  },
};

const sonosSpeakers = new SonosSpeakers();
onMounted(async () => {
  window.connectElgatoStreamDeckSocket = (exPort, exPluginUUID, exRegisterEvent, exInfo) => {
    $SD.value = new StreamDeck(exPort, exPluginUUID, exRegisterEvent, exInfo, "{}");
    // $SONOS.value = new SonosController();
    $SD.value.on("connected", () => {
      $SD.value.requestGlobalSettings();
    });

    $SD.value.on("willAppear", (inMessage) => {
      let context = inMessage.context;
      rotationAmount[context] = 0;
      rotationPercent[context] = 0;
      // actionSettings.value[context] = inMessage.payload.settings;
      actionSettings.value[context] = {
        ...inMessage.payload.settings,
        currentStateIndex: inMessage.payload.state || 0,
      };

      // Get the UUID from settings and initialize if needed
      const sonosSpeakerUUID = inMessage.payload.settings?.uuid;

      // When Action is first created UUID is undefined and will be set in didReceiveSettings
      // until then we will just wait for the didReceiveSettings event and handle it from there
      // If the action was already defined this section handles adding the speaker and context
      if (sonosSpeakerUUID) {
        if (!sonosSpeakers.containsContext({ speakerKey: sonosSpeakerUUID, context })) {
          const added = sonosSpeakers.addContext({ speakerKey: sonosSpeakerUUID, context, createIfNotExists: true });
          if (added.status === "SUCCESS") {
            // console.log(`Successfully added context ${context} to speaker ${sonosSpeakerUUID}`);
          } else {
            console.error(`Failed to add context ${context} to speaker ${sonosSpeakerUUID}: ${added.message}`);
          }
        } else {
          console.log(`Context ${context} already exists for speaker ${sonosSpeakerUUID}`);
        }
      }
    });

    $SD.value.on("globalsettings", (inGlobalSettings) => {
      globalSettings.value = inGlobalSettings;
      deviceCheckInterval.value = inGlobalSettings.deviceCheckInterval;
      deviceTimeoutDuration.value = inGlobalSettings.deviceTimeoutDuration;
    });

    $SD.value.on("willDisappear", (inMessage) => {
      let context = inMessage.context;
      delete actionSettings.value[context];

      // Retrieve the UUID from the message payload settings
      const sonosSpeakerUUID = inMessage.payload.settings.uuid;

      // Remove context from the speaker and set deleteIfLast to true
      const removed = sonosSpeakers.removeContext({ speakerKey: sonosSpeakerUUID, context, deleteIfLast: true });
      if (removed.status === "SUCCESS") {
        console.log(`Removed context ${context} from speaker ${sonosSpeakerUUID}`);
      } else {
        console.error(`Failed to remove context ${context} from speaker ${sonosSpeakerUUID}: ${removed.message}`);
      }
    });

    // add async refresh logic here based on actionSettings.value[context].hostAddress
    $SD.value.on("didReceiveSettings", (inMessage) => {
      let context = inMessage.context;
      rotationAmount[context] = 0;

      actionSettings.value[context] = {
        ...inMessage.payload.settings,
        currentStateIndex: inMessage.payload.state || 0,
      };

      const sonosSpeakerUUID = inMessage.payload.settings.uuid;

      if (sonosSpeakerUUID) {
        // Get current speaker assigned to this context
        const currentSpeakerUUID = sonosSpeakers.getSpeakerByContext({ context });

        if (currentSpeakerUUID === sonosSpeakerUUID) {
          // Do nothing since the speaker is already assigned to this context
        } else if (currentSpeakerUUID && currentSpeakerUUID !== sonosSpeakerUUID) {
          // Attempt to move context from old speaker
          const moved = sonosSpeakers.moveContext({ speakerKey: sonosSpeakerUUID, context, deleteIfLast: true, createIfNotExists: true });
          if (moved.status === "SUCCESS") {
            // console.log(`Moved context ${context} from speaker ${currentSpeakerUUID} to ${sonosSpeakerUUID}`);
          } else {
            console.error(`Failed to move context ${context} from speaker ${currentSpeakerUUID} to ${sonosSpeakerUUID}: ${moved.message}`);
          }
        } else {
          // If the context is not moving from a different speaker, just add it to the new speaker
          const added = sonosSpeakers.addContext({ speakerKey: sonosSpeakerUUID, context, createIfNotExists: true });
          if (added.status === "SUCCESS") {
            // console.log(`Added context ${context} to speaker ${sonosSpeakerUUID}`);
          } else {
            console.error(`Failed to add context ${context} to speaker ${sonosSpeakerUUID}: ${added.message}`);
          }
        }
      }
    });

    // Actions below
    $SD.value.on("dialRotate", (inMessage) => {
      let context = inMessage.context;

      let scaledTicks = inMessage.payload.ticks;
      let tickBucketSizeMs = 300;

      rotationAmount[context] += scaledTicks;
      // rotationPercent[context] += scaledTicks;
      // if (rotationPercent[context] < 0) {
      //   rotationPercent[context] = 0;
      // } else if (rotationPercent[context] > 100) {
      //   rotationPercent[context] = 100;
      // }

      if (rotationTimeout[context]) return;

      let serviceCall = () => {
        callAction({
          inContext: context,
          inEvent: inMessage.event,
          inRotation: {
            ticks: rotationAmount[context],
            // rotationPercent: rotationPercent[context],
            // rotationAbsolute: 2.55 * rotationPercent[context],
          },
        });
        rotationAmount[context] = 0;
        rotationTimeout[context] = null;
      };

      if (tickBucketSizeMs > 0) {
        rotationTimeout[context] = setTimeout(serviceCall, tickBucketSizeMs);
      } else {
        serviceCall();
      }
    });

    $SD.value.on("keyDown", (inMessage) => {
      let context = inMessage.context;
      callAction({ inContext: context, inEvent: inMessage.event });
    });

    // $SD.value.on("keyUp", (inMessage) => {});

    $SD.value.on("dialDown", (inMessage) => {
      let context = inMessage.context;

      callAction({ inContext: context, inEvent: inMessage.event });
    });

    // $SD.value.on("dialUp", (inMessage) => {});

    $SD.value.on("touchTap", (inMessage) => {
      let context = inMessage.context;

      callAction({ inContext: context, inEvent: inMessage.event });
    });

    setInterval(() => {
      // try {
      sonosSpeakers.getAllSpeakers().forEach(async (sonosSpeakerUUID) => {
        //  Temp debug logic to stop the interval from running in loop
        // deviceCheckInterval.value = 0;
        const speaker = sonosSpeakers.getDevice({ speakerKey: sonosSpeakerUUID });
        const contexts = speaker.contexts;
        if (speaker.status !== "UPDATING" && speaker.status !== "RATE_LIMITED" && speaker.secondsSinceChecked >= deviceCheckInterval.value) {
          const hostAddress = globalSettings.value.devices[sonosSpeakerUUID].hostAddress;
          try {
            const sonosController = new SonosController();
            sonosController.connect(hostAddress);
            sonosSpeakers.setStatus({ speakerKey: sonosSpeakerUUID, status: "UPDATING" });
            const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout getting devices")), deviceTimeoutDuration.value * 1000));
            const updatedDeviceInfo = await Promise.race([sonosController.getDeviceInfo(), timeout]);
            if (!updatedDeviceInfo.timedOut) {
              clearTimeout(updatedDeviceInfo.timedOut);
              sonosSpeakers.updateDeviceInfo({ speakerKey: sonosSpeakerUUID, deviceInfo: updatedDeviceInfo, updateLastChecked: true });
            }
          } catch (error) {
            console.log(`Failed to get device info for ${hostAddress}: ${error}`);
            contexts.forEach((context) => {
              $SD.value.showAlert({ context });
            });
            sonosSpeakers.setStatus({ speakerKey: sonosSpeakerUUID, status: "DISCONNECTED" });
          }
        }
        const device = sonosSpeakers.getDevice({ speakerKey: sonosSpeakerUUID });
        if (device.status === "UPDATED") {
          contexts.forEach((context) => {
            refreshStateAndTitle({ inContext: context, inSonosSpeakerState: device.deviceInfo });
          });
        }
      });
    }, 0.5 * 1e3);
  };
});

function callAction({ inContext, inEvent, inRotation = null }) {
  const settings = actionSettings.value[inContext];
  const actionName = settings.action.split(".").pop();
  // const controller = settings.controller.toLowerCase();

  Object.keys(actionFunctionMap).map((key) => {
    if (key === actionName) {
      if (actionFunctionMap[key][inEvent]) {
        actionFunctionMap[key][inEvent].forEach(async (actionFunction) => {
          const sonosSpeakerUUID = sonosSpeakers.getSpeakerByContext({ context: inContext });
          const speaker = sonosSpeakers.getDevice({ speakerKey: sonosSpeakerUUID });
          sonosSpeakers.setStatus({ speakerKey: sonosSpeakerUUID, status: "UPDATING" });
          const actionResult = await actionFunction({
            inContext,
            inActionSettings: settings,
            inSonosSpeakerState: speaker.deviceInfo,
            inRotation,
            deviceTimeoutDuration: deviceTimeoutDuration.value,
          });
          if (actionResult.status === "SUCCESS") {
            sonosSpeakers.updateDeviceInfo({ speakerKey: sonosSpeakerUUID, deviceInfo: actionResult.updatedSonosSpeakerState });
          } else {
            const contexts = speaker.contexts;
            contexts.forEach((context) => {
              $SD.value.showAlert({ context });
            });
            sonosSpeakers.setStatus({ speakerKey: sonosSpeakerUUID, status: "DISCONNECTED" });
          }
        });
      }
    }
  });
}

async function refreshStateAndTitle({ inContext, inSonosSpeakerState }) {
  const settings = actionSettings.value[inContext];
  const actionName = settings.action.split(".").pop();
  const controller = settings.controller.toLowerCase();
  const currentStateIndex = settings.currentStateIndex;

  // Check if state is explicitly null first
  if (actionFunctionMap[actionName]?.state === null) {
    return;
  }

  if (actionFunctionMap[actionName]?.state) {
    const stateHandler = actionFunctionMap[actionName].state[controller] || actionFunctionMap[actionName].state.default;
    if (stateHandler) {
      const stateResult = await stateHandler({
        inContext,
        inActionSettings: settings,
        inSonosSpeakerState,
        StreamDeckConnection: $SD.value,
      });
      if (stateResult.status === "SUCCESS" && stateResult.futureStateIndex !== currentStateIndex) {
        actionSettings.value[inContext].currentStateIndex = stateResult.futureStateIndex;
      } else if (stateResult.status === "SUCCESS" && stateResult.futureStateIndex === currentStateIndex) {
        // This is a no-op to handle the case where the state is already up to date
      } else {
        console.log(`[Refresh State and Title] Failed to update state for context ${inContext} [${settings.action}] from ${currentStateIndex} to ${stateResult.futureStateIndex}`);
      }
    } else {
      console.log(`No state handler found for ${actionName} (controller: ${controller})`);
    }
  } else {
    console.log(`No state configuration for ${actionName}`);
  }
}
</script>
