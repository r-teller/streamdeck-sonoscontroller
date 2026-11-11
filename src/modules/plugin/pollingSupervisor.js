import { SonosController } from "../common/sonosController.js";
import { getAllSpeakers, getSpeaker, updateSpeakerState, setOperationalStatus, TIME_WINDOW_SECONDS } from "./SonosSpeakers.js";
import { OPERATIONAL_STATUS } from "./operationalStatus.js";
import { resolveSpeaker } from "../common/speakerResolver.js";
import { globalSettings } from "./globalSettings.js";
import { speakerHasFavoriteKeys } from "./favoriteKeys.js";
import { actionSettings } from "./actionSettings.js";
import { positionSnapshot } from "./trackTime.js";
import { refreshPlaylist, isInPlaylist } from "./favoritesPlaylist.js";

export const QUEUE_DIAL_ACTION = "encoder-queue-track";
/** Play mode only changes on the queue, so these actions need the media URI (sonos-8cc). */
export const PLAY_MODE_ACTION_NAMES = new Set(["toggle-play-mode", "encoder-play-mode"]);

function speakerHasAction(UUID, names) {
  const speaker = getAllSpeakers()[UUID];
  return !!speaker?.contexts?.some((c) => names.has(actionSettings[c]?.action?.split(".").pop()));
}

/** True when a Queue Track dial is bound to this speaker (it needs the queue signature, sonos-gen.2). */
export function speakerHasQueueDial(UUID) {
  return speakerHasAction(UUID, new Set([QUEUE_DIAL_ACTION]));
}

export function speakerHasPlayModeAction(UUID) {
  return speakerHasAction(UUID, PLAY_MODE_ACTION_NAMES);
}

/** The heart key (sonos-bg0.4). */
export const FAVORITE_TRACK_ACTION = "toggle-favorite-track";
const HEART_BADGE_ACTIONS = new Set(["currently-playing", "toggle-play-pause"]);

/**
 * True when a key on this speaker shows whether the playing song is in the Stream Deck Favorites
 * playlist: the heart key, or a Currently Playing / Play-Pause key with the heart badge on (sonos-bg0.3).
 */
export function speakerNeedsFavoritesPlaylist(UUID) {
  const speaker = getAllSpeakers()[UUID];
  return !!speaker?.contexts?.some((c) => {
    const s = actionSettings[c];
    const name = s?.action?.split(".").pop();
    if (name === FAVORITE_TRACK_ACTION) return true;
    return HEART_BADGE_ACTIONS.has(name) && s.displayAlbumArt === true && s.displayFavoriteBadge !== false;
  });
}

export function startPollingSupervisor({
  intervalMs = 500,
  getDeviceCheckIntervalSeconds = () => 10,
  getDeviceTimeoutDurationSeconds = () => 5,
  controllerFactory = (host, uuid) => new SonosController().connect(host, { uuid }),
  showAlert = () => {},
  refreshStateAndTitle = () => {},
  getGlobals = () => globalSettings,
  needsFavoriteInfo = (UUID) => speakerHasFavoriteKeys(UUID) || speakerHasQueueDial(UUID),
  needsMediaUri = (UUID) => speakerHasPlayModeAction(UUID),
  needsFavoritesPlaylist = (UUID) => speakerNeedsFavoritesPlaylist(UUID),
  afterPoll = () => {},
} = {}) {
  let intervalId = null;

  async function pollSpeaker(UUID, speaker) {
    try {
      setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATING });
      const startVersion = getSpeaker({ UUID }).stateVersion ?? 0;

      const reReadSpeaker = getSpeaker({ UUID });
      if (reReadSpeaker.operationalStatus === OPERATIONAL_STATUS.RATE_LIMITED) {
        return;
      }

      // Resolve per poll so IP changes / replacements in global settings take effect immediately.
      const target = resolveSpeaker({ uuid: UUID, hostAddress: speaker.hostAddress, zoneName: speaker.zoneName }, getGlobals());
      const controller = controllerFactory(target.hostAddress, target.uuid);
      const seconds = getDeviceTimeoutDurationSeconds();
      let timeoutId;

      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`Timeout while polling speaker after ${seconds} seconds`)),
          seconds * 1000,
        );
      });

      try {
        const fetchAll = async () => {
          const base = await Promise.all([
            controller.getTransportSettings(),
            controller.getTransportInfo(),
            controller.getMute(),
            controller.getVolume(),
            controller.getBass(),
            controller.getTreble(),
            controller.getPositionInfo(),
          ]);
          // Favorite keys need to know which queue is loaded (sonos-gw5); skip for other speakers.
          const favoriteInfo = {};
          const wantsQueue = needsFavoriteInfo(UUID);
          if (typeof controller.getMediaInfo === "function" && (wantsQueue || needsMediaUri(UUID))) {
            const media = await controller.getMediaInfo();
            favoriteInfo.mediaURI = media.currentURI;
            // The queue signature (a Browse) is only for favorites and the queue dial.
            if (wantsQueue) {
              favoriteInfo.queueSignature = String(media.currentURI).startsWith("x-rincon-queue:")
                ? await controller.getQueueSignature()
                : null;
            }
          }
          // Stream Deck Favorites playlist (sonos-bg0.3): a 1-item read unless it changed. A failure
          // here must not mark the speaker disconnected; the heart just keeps its last value.
          if (typeof controller.findPlaylist === "function" && needsFavoritesPlaylist(UUID)) {
            try {
              await refreshPlaylist(UUID, controller);
              favoriteInfo.inFavorites = isInPlaylist(UUID, base[6]?.trackURI);
            } catch (e) {
              // keep polling
            }
          }
          return [...base, favoriteInfo];
        };
        const [transportSettings, transportInfo, muted, volume, bass, treble, positionInfo, favoriteInfo] = await Promise.race([
          fetchAll(),
          timeoutPromise,
        ]);

        // Guard against in-flight poll resurrecting a speaker whose last context was removed
        if (!(UUID in getAllSpeakers())) return;
        // An action ran while this poll was in flight: its reading predates the action, so applying it
        // would undo the action's projection. Leave lastChecked alone so the next tick re-polls (sonos-e9y).
        if ((getSpeaker({ UUID }).stateVersion ?? 0) !== startVersion) return;

        const state = {
          playMode: transportSettings.playMode,
          playbackState: transportInfo.playbackState,
          muted,
          audioEqualizer: { volume, bass, treble },
          currentURI: positionInfo.trackURI,
          // 1-based position in the queue (0 when not playing from the queue)
          trackNumber: positionInfo.track,
          // Elapsed / length at this moment; keys count on from here (sonos-bg0.2).
          position: positionSnapshot(positionInfo),
          playing: {
            title: positionInfo.title,
            artist: positionInfo.artist,
            album: positionInfo.album,
            albumArtURI: positionInfo.albumArtURI,
          },
          ...favoriteInfo,
        };

        updateSpeakerState({ UUID, state, updateLastChecked: true });
        setOperationalStatus({ UUID, operationalStatus: OPERATIONAL_STATUS.UPDATED });
        try {
          afterPoll(UUID);
        } catch (e) {
          // never let post-poll bookkeeping break rendering
        }

        for (const context of speaker.contexts) {
          refreshStateAndTitle({ inContext: context, inSonosSpeakerState: state });
        }
      } catch (err) {
        // Guard against in-flight poll resurrecting a speaker whose last context was removed
        if (!(UUID in getAllSpeakers())) return;
        // Back off a full check interval; without this a fast-failing speaker (powered off, refused
        // connection) was re-polled every tick and tripped RATE_LIMITED (sonos-j3f).
        getSpeaker({ UUID }).lastChecked = Date.now() / 1000;
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
      if (speaker.operationalStatus === OPERATIONAL_STATUS.UPDATING) {
        continue;
      }
      // RATE_LIMITED is a cool-down, not a dead end: once the attempt window has passed, poll again so
      // keys recover when the speaker comes back (previously only a key press could clear it, sonos-j3f).
      if (
        speaker.operationalStatus === OPERATIONAL_STATUS.RATE_LIMITED &&
        (speaker.updateAttempts ?? []).some((ts) => now - ts <= TIME_WINDOW_SECONDS)
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
