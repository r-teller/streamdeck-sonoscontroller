import { SonosController } from "../common/sonosController.js";
import { getAllSpeakers, getSpeaker, updateSpeakerState, setOperationalStatus } from "./SonosSpeakers.js";
import { OPERATIONAL_STATUS } from "./operationalStatus.js";

export function startPollingSupervisor({
  intervalMs = 500,
  getDeviceCheckIntervalSeconds = () => 10,
  getDeviceTimeoutDurationSeconds = () => 5,
  controllerFactory = (host, uuid) => new SonosController().connect(host, { uuid }),
  showAlert = () => {},
  refreshStateAndTitle = () => {},
} = {}) {
  let intervalId = null;

  async function pollSpeaker(UUID, speaker) {
    try {
      setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATING });

      const reReadSpeaker = getSpeaker({ UUID });
      if (reReadSpeaker.operationalStatus === OPERATIONAL_STATUS.RATE_LIMITED) {
        return;
      }

      const controller = controllerFactory(speaker.hostAddress, UUID);
      const seconds = getDeviceTimeoutDurationSeconds();
      let timeoutId;

      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Timeout while polling speaker after ${seconds} seconds`)),
          seconds * 1000,
        );
      });

      try {
        const [transportSettings, transportInfo, muted, volume, bass, treble, positionInfo] = await Promise.race([
          Promise.all([
            controller.getTransportSettings(),
            controller.getTransportInfo(),
            controller.getMute(),
            controller.getVolume(),
            controller.getBass(),
            controller.getTreble(),
            controller.getPositionInfo(),
          ]),
          timeoutPromise,
        ]);

        // Guard against in-flight poll resurrecting a speaker whose last context was removed
        if (!(UUID in getAllSpeakers())) return;

        const state = {
          playMode: transportSettings.playMode,
          playbackState: transportInfo.playbackState,
          muted,
          audioEqualizer: { volume, bass, treble },
          currentURI: positionInfo.trackURI,
          playing: {
            title: positionInfo.title,
            artist: positionInfo.artist,
            album: positionInfo.album,
            albumArtURI: positionInfo.albumArtURI,
          },
        };

        updateSpeakerState({ UUID, state, updateLastChecked: true });
        setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATED });

        for (const context of speaker.contexts) {
          refreshStateAndTitle({ inContext: context, inSonosSpeakerState: state });
        }
      } catch (err) {
        // Guard against in-flight poll resurrecting a speaker whose last context was removed
        if (!(UUID in getAllSpeakers())) return;
        setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.DISCONNECTED });
        for (const context of speaker.contexts) {
          showAlert({ context });
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      // Swallow all errors to ensure pollSpeaker never rejects
    }
  }

  function tick() {
    const now = Date.now() / 1000; // epoch seconds

    for (const [UUID, speaker] of Object.entries(getAllSpeakers())) {
      if (
        speaker.operationalStatus === OPERATIONAL_STATUS.UPDATING ||
        speaker.operationalStatus === OPERATIONAL_STATUS.RATE_LIMITED
      ) {
        continue;
      }

      if (now - (speaker.lastChecked ?? 0) < getDeviceCheckIntervalSeconds()) {
        continue;
      }

      pollSpeaker(UUID, speaker);
    }
  }

  intervalId = setInterval(tick, intervalMs);

  return function stop() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}
