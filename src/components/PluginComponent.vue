<template>
  <span>Nothing to see here Plv4!</span>
</template>

<script setup>
import { StreamDeck } from "@/modules/common/streamdeck";

import { SonosController } from "@/modules/common/sonosController";
import { sonosControllerActions } from "@/modules/actions/sonosController";
import SonosSpeakers from "@/modules/plugin/SonosSpeakers";
import { onMounted, ref } from "vue";

const streamDeckConnection = ref(null);

const globalSettings = ref({});
const actionSettings = ref([]);

const deviceCheckInterval = ref(10);
const deviceTimeoutDuration = ref(5);

// At some point we may want to add a speaker check interval and timeout duration
// const speakerCheckInterval = ref(10);
// const speakerTimeoutDuration = ref(5);

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
  "currently-playing": {
    keyDown: [sonosControllerActions.currentlyPlaying.action],
    state: {
      default: sonosControllerActions.currentlyPlaying.state.default,
      keypad: null,
      encoder: null,
    },
  },
};

const sonosSpeakers = new SonosSpeakers();
onMounted(async () => {
  window.connectElgatoStreamDeckSocket = (exPort, exPluginUUID, exRegisterEvent, exInfo) => {
    streamDeckConnection.value = new StreamDeck(exPort, exPluginUUID, exRegisterEvent, exInfo, "{}");

    streamDeckConnection.value.on("connected", () => {
      streamDeckConnection.value.requestGlobalSettings();
    });

    streamDeckConnection.value.on("willAppear", (inMessage) => {
      let context = inMessage.context;
      rotationAmount[context] = 0;
      rotationPercent[context] = 0;
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
        if (!sonosSpeakers.containsContext({ UUID: sonosSpeakerUUID, context })) {
          const added = sonosSpeakers.addContext({
            UUID: sonosSpeakerUUID,
            context,
            createIfNotExists: true,
          });
          if (added.status !== "SUCCESS") {
            console.error(`Failed to add context ${context} to speaker ${sonosSpeakerUUID}: ${added.message}`);
          }
        }
      }
    });

    streamDeckConnection.value.on("globalsettings", (inGlobalSettings) => {
      globalSettings.value = inGlobalSettings;
      deviceCheckInterval.value = inGlobalSettings.deviceCheckInterval;
      deviceTimeoutDuration.value = inGlobalSettings.deviceTimeoutDuration;
    });

    streamDeckConnection.value.on("willDisappear", (inMessage) => {
      let context = inMessage.context;
      delete actionSettings.value[context];

      // Retrieve the UUID from the message payload settings
      const sonosSpeakerUUID = inMessage.payload.settings.uuid;

      // Remove context from the speaker and set deleteIfLast to true
      const removed = sonosSpeakers.removeContext({
        UUID: sonosSpeakerUUID,
        context,
        deleteIfLast: true,
      });
      if (removed.status === "SUCCESS") {
        console.log(`Removed context ${context} from speaker ${sonosSpeakerUUID}`);
      } else {
        console.error(`Failed to remove context ${context} from speaker ${sonosSpeakerUUID}: ${removed.message}`);
      }
    });

    // add async refresh logic here based on actionSettings.value[context].hostAddress
    streamDeckConnection.value.on("didReceiveSettings", (inMessage) => {
      console.log(inMessage);
      let context = inMessage.context;
      rotationAmount[context] = 0;

      actionSettings.value[context] = {
        ...inMessage.payload.settings,
        currentStateIndex: inMessage.payload.state || 0,
      };

      const sonosSpeakerUUID = inMessage.payload.settings.uuid;

      if (sonosSpeakerUUID) {
        const currentSpeaker = sonosSpeakers.getSpeakerByContext({ context });

        if (currentSpeaker.status === "SUCCESS" && currentSpeaker.UUID === sonosSpeakerUUID) {
          // Do nothing since the speaker is already assigned to this context
        } else if (currentSpeaker.status === "SUCCESS" && currentSpeaker.UUID !== sonosSpeakerUUID) {
          const moved = sonosSpeakers.moveContext({
            UUID: sonosSpeakerUUID,
            context,
            deleteIfLast: true,
            createIfNotExists: true,
          });
          if (moved.status !== "SUCCESS") {
            console.error(
              `Failed to move context ${context} from speaker ${currentSpeaker.UUID} to ${sonosSpeakerUUID}: ${moved.message}`,
            );
          }
        } else {
          // If the context is not moving from a different speaker, just add it to the new speaker
          const added = sonosSpeakers.addContext({
            UUID: sonosSpeakerUUID,
            context,
            createIfNotExists: true,
          });
          if (added.status === "SUCCESS") {
            // console.log(`Added context ${context} to speaker ${sonosSpeakerUUID}`);
          } else {
            console.error(`Failed to add context ${context} to speaker ${sonosSpeakerUUID}: ${added.message}`);
          }
        }
      }
    });

    // Actions below
    streamDeckConnection.value.on("dialRotate", (inMessage) => {
      let context = inMessage.context;

      let scaledTicks = inMessage.payload.ticks;
      let tickBucketSizeMs = 300;

      rotationAmount[context] += scaledTicks;

      if (rotationTimeout[context]) return;

      let serviceCall = () => {
        callAction({
          inContext: context,
          inEvent: inMessage.event,
          inRotation: {
            ticks: rotationAmount[context],
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

    streamDeckConnection.value.on("keyDown", (inMessage) => {
      let context = inMessage.context;
      callAction({ inContext: context, inEvent: inMessage.event });
    });

    // streamDeckConnection.value.on("keyUp", (inMessage) => {});

    streamDeckConnection.value.on("dialDown", (inMessage) => {
      let context = inMessage.context;

      callAction({ inContext: context, inEvent: inMessage.event });
    });

    // streamDeckConnection.value.on("dialUp", (inMessage) => {});

    streamDeckConnection.value.on("touchTap", (inMessage) => {
      let context = inMessage.context;

      callAction({ inContext: context, inEvent: inMessage.event });
    });

    setInterval(() => {
      sonosSpeakers.getAllSpeakers().UUIDs.forEach(async (sonosSpeakerUUID) => {
        const speaker = sonosSpeakers.getSpeaker({ UUID: sonosSpeakerUUID });
        if (speaker.status === "ERROR") {
          console.error(`Failed to get speaker info for ${sonosSpeakerUUID}: ${speaker.message}`);
          return;
        }
        const contexts = speaker.contexts;
        if (
          speaker.operationalStatus !== SonosSpeakers.OPERATIONAL_STATUS.UPDATING &&
          speaker.operationalStatus !== SonosSpeakers.OPERATIONAL_STATUS.RATE_LIMITED &&
          speaker.secondsLastChecked >= deviceCheckInterval.value
        ) {
          const hostAddress = globalSettings.value.devices[sonosSpeakerUUID].hostAddress;
          try {
            const sonosController = new SonosController();
            sonosController.connect(hostAddress);
            sonosSpeakers.setOperationalStatus({
              UUID: sonosSpeakerUUID,
              operationalStatus: SonosSpeakers.OPERATIONAL_STATUS.UPDATING,
            });
            const timeout = new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error(`Timeout getting speaker info for ${sonosSpeakerUUID} [${hostAddress}]`)),
                deviceTimeoutDuration.value * 1000,
              ),
            );
            const updatedSpeakerState = await Promise.race([sonosController.getDeviceInfo(), timeout]);
            if (!updatedSpeakerState.timedOut) {
              clearTimeout(updatedSpeakerState.timedOut);
              sonosSpeakers.updateSpeakerState({
                UUID: sonosSpeakerUUID,
                state: updatedSpeakerState,
                updateLastChecked: true,
              });
            }
          } catch (error) {
            console.log(`Failed to get device info for ${hostAddress}: ${error}`);
            contexts.forEach((context) => {
              streamDeckConnection.value.showAlert({ context });
            });
            sonosSpeakers.setOperationalStatus({
              UUID: sonosSpeakerUUID,
              operationalStatus: SonosSpeakers.OPERATIONAL_STATUS.DISCONNECTED,
            });
          }
        }
        const updatedSpeaker = sonosSpeakers.getSpeaker({
          UUID: sonosSpeakerUUID,
        });
        if (updatedSpeaker.operationalStatus === SonosSpeakers.OPERATIONAL_STATUS.UPDATED) {
          contexts.forEach((context) => {
            refreshStateAndTitle({
              inContext: context,
              inSonosSpeakerState: updatedSpeaker.state,
            });
          });
        }
      });
    }, 0.5 * 1000);
  };
});

function callAction({ inContext, inEvent, inRotation = null }) {
  const settings = actionSettings.value[inContext];
  const actionName = settings.action.split(".").pop();

  Object.keys(actionFunctionMap).map((key) => {
    if (key === actionName) {
      if (actionFunctionMap[key][inEvent]) {
        actionFunctionMap[key][inEvent].forEach(async (actionFunction) => {
          const sonosSpeakerResult = sonosSpeakers.getSpeakerByContext({
            context: inContext,
          });
          if (sonosSpeakerResult.status !== "SUCCESS") {
            console.error(`Failed to get speaker for context ${inContext}: ${sonosSpeakerResult.message}`);
            return;
          }
          const sonosSpeakerUUID = sonosSpeakerResult.UUID;
          const speaker = sonosSpeakers.getSpeaker({ UUID: sonosSpeakerUUID });
          if (speaker.status !== "SUCCESS") {
            console.error(`Failed to get speaker info for ${sonosSpeakerUUID}: ${speaker.message}`);
            return;
          }
          sonosSpeakers.setOperationalStatus({
            UUID: sonosSpeakerUUID,
            operationalStatus: SonosSpeakers.OPERATIONAL_STATUS.UPDATING,
          });
          const actionResult = await actionFunction({
            inContext,
            inActionSettings: settings,
            inSonosSpeakerState: speaker.state,
            inRotation,
            deviceTimeoutDuration: deviceTimeoutDuration.value,
          });
          if (actionResult.status === "SUCCESS") {
            sonosSpeakers.updateSpeakerState({
              UUID: sonosSpeakerUUID,
              state: actionResult.updatedSonosSpeakerState,
            });
          } else {
            const contexts = speaker.contexts;
            contexts.forEach((context) => {
              streamDeckConnection.value.showAlert({ context });
            });
            sonosSpeakers.setOperationalStatus({
              UUID: sonosSpeakerUUID,
              operationalStatus: SonosSpeakers.OPERATIONAL_STATUS.DISCONNECTED,
            });
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
        StreamDeckConnection: streamDeckConnection.value,
      });
      if (stateResult.status === "SUCCESS" && stateResult.futureStateIndex !== currentStateIndex) {
        actionSettings.value[inContext].currentStateIndex = stateResult.futureStateIndex;
      } else if (stateResult.status !== "SUCCESS") {
        console.error(`[Refresh State and Title] Failed to update state for context ${inContext}: ${stateResult.message}`);
      }
    } else {
      console.log(`No state handler found for ${actionName} (controller: ${controller})`);
    }
  } else {
    console.log(`No state configuration for ${actionName}`);
  }
}
</script>
