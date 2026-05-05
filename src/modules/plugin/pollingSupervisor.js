/**
 * 500ms polling supervisor.
 *
 * Walks the SonosSpeakers store every tick and dispatches a 7-call SOAP
 * fan-out to any speaker that is (a) not currently UPDATING / RATE_LIMITED
 * and (b) overdue per `deviceCheckInterval`. Each fetch races against
 * `deviceTimeoutDuration` ms; on timeout or thrown exception the speaker
 * flips to DISCONNECTED and every bound context receives a `showAlert`.
 *
 * Side-effect imports tie the module to the singleton store. Pure functions
 * are exported separately so tests can drive them with a fake clock.
 *
 * See backend.md §"Polling supervisor" and prd-what.md §8.1 / §8.3.
 */

import { reactive as _r } from "vue"; // eslint-disable-line no-unused-vars
import {
  sonosSpeakers,
  setOperationalStatus,
  updateSpeakerState,
} from "./SonosSpeakers.js";
import { OPERATIONAL_STATUS } from "./operationalStatus.js";
import { SonosController } from "@/modules/common/sonosController.js";

export const SUPERVISOR_TICK_MS = 500;

/**
 * Default factory: construct a fresh SonosController per fetch and bind it
 * to the speaker's host. Tests inject a fake factory.
 */
function defaultControllerFactory(hostAddress) {
  const controller = new SonosController();
  controller.connect(hostAddress);
  return controller;
}

/**
 * Run the 7-call fan-out against a single speaker, race it against the
 * timeout, and write results back to the store. Pure function — caller
 * provides the speaker record + injectables.
 *
 * @returns {Promise<void>} Resolves after store mutations complete.
 *   Never rejects — failures are captured into DISCONNECTED + showAlert.
 */
export async function pollSpeaker({
  uuid,
  speaker,
  deviceTimeoutDurationSeconds,
  controllerFactory = defaultControllerFactory,
  showAlert,
  refreshStateAndTitle,
}) {
  setOperationalStatus({
    UUID: uuid,
    operationalStatus: OPERATIONAL_STATUS.UPDATING,
  });
  // The rate limiter inside setOperationalStatus may have flipped us.
  if (sonosSpeakers[uuid]?.operationalStatus === OPERATIONAL_STATUS.RATE_LIMITED) {
    return;
  }

  const controller = controllerFactory(speaker.hostAddress);

  const fetchPromise = (async () => {
    const [transportSettings, transportInfo, mute, volume, bass, treble, positionInfo] =
      await Promise.all([
        controller.getTransportSettings(),
        controller.getTransportInfo(),
        controller.getMute(),
        controller.getVolume(),
        controller.getBass(),
        controller.getTreble(),
        controller.getPositionInfo(),
      ]);
    return {
      playMode: transportSettings.playMode,
      playbackState: transportInfo.playbackState,
      muted: mute,
      audioEqualizer: { volume, bass, treble },
      currentURI: positionInfo.trackURI,
      playing: {
        title: positionInfo.title,
        artist: positionInfo.artist,
        album: positionInfo.album,
        albumArtURI: positionInfo.albumArtURI,
      },
    };
  })();

  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(
      () =>
        reject(
          new Error(
            `Timeout while polling speaker after ${deviceTimeoutDurationSeconds} seconds`,
          ),
        ),
      deviceTimeoutDurationSeconds * 1000,
    );
  });

  try {
    const state = await Promise.race([fetchPromise, timeoutPromise]);
    clearTimeout(timeoutHandle);
    updateSpeakerState({ UUID: uuid, state, updateLastChecked: true });
    setOperationalStatus({
      UUID: uuid,
      operationalStatus: OPERATIONAL_STATUS.UPDATED,
    });
    if (refreshStateAndTitle) {
      const fresh = sonosSpeakers[uuid];
      if (fresh) {
        for (const ctx of fresh.contexts) {
          refreshStateAndTitle({
            inContext: ctx,
            inSonosSpeakerState: fresh.state,
          });
        }
      }
    }
  } catch (_err) {
    clearTimeout(timeoutHandle);
    setOperationalStatus({
      UUID: uuid,
      operationalStatus: OPERATIONAL_STATUS.DISCONNECTED,
    });
    if (showAlert) {
      // Snapshot contexts before iterating — addContext/removeContext during
      // an alert burst is unlikely but the snapshot keeps the loop simple.
      const contexts = [...(sonosSpeakers[uuid]?.contexts ?? [])];
      for (const ctx of contexts) {
        showAlert({ context: ctx });
      }
    }
  }
}

/**
 * Start the supervisor loop. Returns a stop function so `onBeforeUnmount`
 * can tear it down on hot reload.
 *
 * Injectables (all optional in tests):
 *   - `getDeviceCheckIntervalSeconds()` — global setting; defaults to 10s.
 *   - `getDeviceTimeoutDurationSeconds()` — split per backend.md: polling 5s.
 *   - `controllerFactory(host)` — constructs a SonosController; tests inject.
 *   - `showAlert({context})` — Stream Deck SDK helper.
 *   - `refreshStateAndTitle({inContext, inSonosSpeakerState})` — etr.7 hook.
 *   - `intervalMs` — overridable for tests.
 */
export function startPollingSupervisor({
  getDeviceCheckIntervalSeconds = () => 10,
  getDeviceTimeoutDurationSeconds = () => 5,
  controllerFactory = defaultControllerFactory,
  showAlert,
  refreshStateAndTitle,
  intervalMs = SUPERVISOR_TICK_MS,
} = {}) {
  const tick = () => {
    const now = Date.now() / 1000;
    const deviceCheckInterval = getDeviceCheckIntervalSeconds();
    const timeout = getDeviceTimeoutDurationSeconds();

    for (const uuid of Object.keys(sonosSpeakers)) {
      const speaker = sonosSpeakers[uuid];
      if (!speaker) continue;
      if (
        speaker.operationalStatus === OPERATIONAL_STATUS.UPDATING ||
        speaker.operationalStatus === OPERATIONAL_STATUS.RATE_LIMITED
      ) {
        continue;
      }
      const lastChecked = speaker.lastChecked ?? 0;
      if (now - lastChecked < deviceCheckInterval) continue;

      // Fire-and-forget — speakers fetch in parallel; each is gated by its
      // own UPDATING flag so re-entry on the next tick is safe.
      pollSpeaker({
        uuid,
        speaker,
        deviceTimeoutDurationSeconds: timeout,
        controllerFactory,
        showAlert,
        refreshStateAndTitle,
      });
    }
  };

  const intervalHandle = setInterval(tick, intervalMs);
  return () => clearInterval(intervalHandle);
}
