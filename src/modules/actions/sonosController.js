import { SonosController } from "@/modules/common/sonosController";
import { Buffer } from "buffer";

export const sonosControllerActions = {
  toggleMuteUnmute: {
    action: toggle_mute_unmute_action,
    state: {
      default: toggle_mute_unmute_state,
      keypad: null,
      encoder: null,
    },
  },
  togglePlayPause: {
    action: toggle_play_pause_action,
    state: {
      default: toggle_play_pause_state,
      keypad: null,
      encoder: null,
    },
  },
  togglePlayMode: {
    action: toggle_play_mode_action,
    state: {
      default: toggle_play_mode_state,
      keypad: null,
      encoder: null,
    },
  },
  toggleInputSource: {
    action: toggle_input_source_action,
    state: {
      default: toggle_input_source_state,
      keypad: null,
      encoder: null,
    },
  },
  playNextTrack: {
    action: play_next_track_action,
    state: {
      keypad: generic_state,
    },
  },
  playPreviousTrack: {
    action: play_previous_track_action,
    state: {
      keypad: generic_state,
    },
  },
  playSonosFavorite: {
    action: play_sonos_favorite_action,
    state: {
      default: play_sonos_favorite_state,
    },
  },
  volumeUp: {
    action: volume_up_action,
    state: {
      keypad: generic_state,
    },
  },
  volumeDown: {
    action: volume_down_action,
    state: {
      keypad: generic_state,
    },
  },
  encoderAudioEqualizer: {
    action: encoder_audio_equalizer_action,
    state: {
      encoder: encoder_audio_equalizer_state,
    },
  },
  currentlyPlaying: {
    action: refresh_speaker_state_action,
    state: {
      default: currently_playing_state,
    },
  },
};

/** Helper functions Start */

// Helper function to determine current source from URI
/**
 * Get input source mappings from URI
 * @param {string} uri - The URI to get the input source mappings from
 * @returns {object} - An object with sourceName and generateUri properties
 * @property {string} sourceName - The name of the current source
 * @property {object} generateUri - An object with the current source and the prefixes and suffixes to generate the URI for each source
 */
const getInputSourceMappings = (uri) => {
  const sourceMap = {
    TV_Input: {
      detect: () => uri?.startsWith("x-sonos-htastream") && uri?.endsWith(":spdif"),
      prefix: () => `x-sonos-htastream`,
      suffix: () => `:spdif`,
    },
    Line_In: {
      detect: () => uri?.startsWith("x-rincon-stream"),
      prefix: () => `x-rincon-stream`,
      suffix: () => ``,
    },
    Sonos_Queue: {
      detect: () => true, // Default fallback
      prefix: () => `x-rincon-queue`,
      suffix: () => `#0`,
    },
  };

  const [currentSource] =
    Object.entries(sourceMap).find(([, config]) => config.detect(uri)) || [];
  // const [currentSource] = Object.entries(sourceMap).find(([config]) => config.detect(uri));
  // const [currentSource = undefined] = Object.entries(sourceMap).find(([, config]) => config.detect(uri)) || [];
  return {
    sourceName: currentSource,
    generateUri: Object.entries(sourceMap).reduce((acc, [key, config]) => {
      acc[key.toUpperCase()] = {
        prefix: config.prefix(),
        suffix: config.suffix(),
      };
      return acc;
    }, {}),
  };
};

/**
 * Update state and title on Stream Deck
 * @param {string} inContext - The context of the action
 * @param {object} inActionSettings - The settings of the action
 * @param {number} stateIndex - The current state index
 * @param {object} StreamDeckConnection - The Stream Deck connection object
 * @param {string} customTitle - The custom title to display
 * @param {string} customAlbumArt - The custom album art to display
 * @param {string} customAlbumTitle - The custom album title to display
 */
function updateStreamDeckStateAndTitle({
  inContext,
  inActionSettings,
  inSonosSpeakerState,
  inFutureStateIndex = inActionSettings.currentStateIndex,
  StreamDeckConnection,
  customTitle = null,
  customAlbumArt = null,
}) {
  const currentStateIndex = inActionSettings?.currentStateIndex;
  const stateName = inActionSettings.states[inFutureStateIndex].Name;
  const marqueeWidth = inActionSettings.marqueeWidth || 10; // Default width of visible text

  customTitle =
    customTitle ||
    stateName
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");

  inActionSettings.status = inActionSettings.status || {};
  const $NOW = new Date().getTime();

  // Only update if state has changed
  if (currentStateIndex !== inFutureStateIndex) {
    // Update state
    StreamDeckConnection.setState({ context: inContext, stateIndex: inFutureStateIndex });
  }

  // Update marquee title if:
  // - Title has never been updated, or
  // - More than 1 second since last update and marquee titles enabled
  if (
    (inActionSettings?.status?.titleLastUpdated === undefined ||
      $NOW - inActionSettings?.status?.titleLastUpdated > 1000 ||
      inActionSettings.currentStateIndex !== inFutureStateIndex) &&
    (inActionSettings?.displayMarqueeTitle ||
      inActionSettings?.displayMarqueeAlbumTitle ||
      inActionSettings?.displayStateBasedTitle)
  ) {
    // Reset marquee position and update title if:
    // - Custom title has changed from last value, or
    // - No title has been set yet
    if (
      inActionSettings?.status?.lastTitleValue === undefined ||
      customTitle !== inActionSettings?.status?.lastCustomTitle ||
      inSonosSpeakerState?.playing?.title !== inActionSettings?.status?.lastPlayingTitle ||
      inActionSettings.currentStateIndex !== inFutureStateIndex
    ) {
      inActionSettings.status.lastCustomTitle = customTitle;
      inActionSettings.status.lastPlayingTitle = inSonosSpeakerState?.playing?.title;

      switch (true) {
        // When both marquee title and album title are enabled, but state-based title is disabled
        case inActionSettings.displayMarqueeTitle &&
          inActionSettings.displayMarqueeAlbumTitle &&
          !inActionSettings?.displayStateBasedTitle:
          if (
            customTitle !== inActionSettings?.status?.lastCustomTitle ||
            inActionSettings?.status?.marqueeTitleTopValue === undefined
          ) {
            // inActionSettings.status.marqueeTitleTopValue = customTitle;
            inActionSettings.status.marqueeTitleTopValue =
              customTitle.length > marqueeWidth
                ? customTitle
                : customTitle.padStart((marqueeWidth + customTitle.length) / 2, " ");

            inActionSettings.marqueePositionTop = 0;
          }
          if (
            inSonosSpeakerState?.playing?.title !==
              inActionSettings?.status?.lastPlayingTitle ||
            inActionSettings?.status?.marqueeTitleBottomValue === undefined
          ) {
            inActionSettings.status.marqueeTitleBottomValue =
              inSonosSpeakerState?.playing?.title;
            inActionSettings.marqueePositionBottom = 0;
          }
          break;

        // When only marquee title is enabled, but album title and state-based title are disabled
        case inActionSettings.displayMarqueeTitle &&
          !inActionSettings?.displayMarqueeAlbumTitle &&
          !inActionSettings?.displayStateBasedTitle:
          if (
            customTitle !== inActionSettings?.status?.lastCustomTitle ||
            inActionSettings?.status?.marqueeTitleTopValue === undefined
          ) {
            inActionSettings.status.marqueeTitleTopValue = customTitle;
            inActionSettings.marqueePositionTop = 0;
          }
          inActionSettings.status.marqueeTitleBottomValue = null;
          break;

        // When state-based title and album title are enabled, but marquee title is disabled
        case inActionSettings.displayStateBasedTitle &&
          inActionSettings?.displayMarqueeAlbumTitle &&
          !inActionSettings?.displayMarqueeTitle:
          if (
            customTitle !== inActionSettings?.status?.lastCustomTitle ||
            inActionSettings?.status?.marqueeTitleTopValue === undefined ||
            inActionSettings.currentStateIndex !== inFutureStateIndex
          ) {
            inActionSettings.status.marqueeTitleTopValue =
              customTitle.length > marqueeWidth
                ? customTitle
                : customTitle.padStart((marqueeWidth + customTitle.length) / 2, " ");
            inActionSettings.marqueePositionTop = 0;
          }
          if (
            inSonosSpeakerState?.playing?.title !==
              inActionSettings?.status?.lastPlayingTitle ||
            inActionSettings?.status?.marqueeTitleBottomValue === undefined
          ) {
            inActionSettings.status.marqueeTitleBottomValue =
              inSonosSpeakerState?.playing?.title;
            inActionSettings.marqueePositionBottom = 0;
          }
          break;

        // When only state-based title is enabled, but album title and marquee title are disabled
        case inActionSettings.displayStateBasedTitle &&
          !inActionSettings?.displayMarqueeAlbumTitle &&
          !inActionSettings?.displayMarqueeTitle:
          if (
            customTitle !== inActionSettings?.status?.lastCustomTitle ||
            inActionSettings?.status?.marqueeTitleTopValue === undefined ||
            inActionSettings.currentStateIndex !== inFutureStateIndex
          ) {
            inActionSettings.status.marqueeTitleTopValue = customTitle;
            inActionSettings.marqueePositionTop = 0;
          }
          inActionSettings.status.marqueeTitleBottomValue = null;
          break;

        // When only album title is enabled, but marquee title and state-based title are disabled
        case inActionSettings.displayMarqueeAlbumTitle &&
          !inActionSettings?.displayMarqueeTitle &&
          !inActionSettings?.displayStateBasedTitle:
          if (
            inSonosSpeakerState?.playing?.title !==
              inActionSettings?.status?.lastPlayingTitle ||
            inActionSettings?.status?.marqueeTitleTopValue === undefined
          ) {
            inActionSettings.status.marqueeTitleTopValue = inSonosSpeakerState?.playing?.title;
            inActionSettings.marqueePositionTop = 0;
          }
          inActionSettings.status.marqueeTitleBottomValue = null;
          break;

        default:
          inActionSettings.status.marqueeTitleTopValue = null;
          inActionSettings.status.marqueeTitleBottomValue = null;
          inActionSettings.marqueePositionTop = 0;
          inActionSettings.marqueePositionBottom = 0;
          console.error(
            `Unexpected condition in marquee state method detected for context ${inContext}\r\n\t Display Marquee Album Title => ${inActionSettings.displayMarqueeAlbumTitle}\r\n\t Display Marquee Title => ${inActionSettings.displayMarqueeTitle}\r\n\t Display State Based Title => ${inActionSettings.displayStateBasedTitle}`
          );
          break;
      }
    }

    let formattedTitle = inActionSettings.status.marqueeTitleTopValue;
    if (
      (inActionSettings?.displayMarqueeTitle || inActionSettings?.displayMarqueeAlbumTitle) &&
      !inActionSettings?.displayStateBasedTitle &&
      formattedTitle?.length > marqueeWidth
    ) {
      const titleTop = formattedTitle;
      const paddedTextTop = `${titleTop}    ${titleTop}`;

      const startIndexTop = inActionSettings.marqueePositionTop;
      const endIndexTop = startIndexTop + marqueeWidth;
      const formattedTitleTop = paddedTextTop.substring(startIndexTop, endIndexTop);

      // Increment position and reset if needed
      inActionSettings.marqueePositionTop++;
      if (inActionSettings.marqueePositionTop >= titleTop.length + 4) {
        // Reset after full scroll + padding
        inActionSettings.marqueePositionTop = 0;
      }
      formattedTitle = formattedTitleTop;
    }

    if (inActionSettings.status.marqueeTitleBottomValue) {
      const titleBottom = inActionSettings.status.marqueeTitleBottomValue;
      const paddedTextBottom = `${titleBottom}    ${titleBottom}`;
      const startIndexBottom = inActionSettings.marqueePositionBottom;
      const endIndexBottom = startIndexBottom + marqueeWidth;
      const formattedTitleBottom = paddedTextBottom.substring(startIndexBottom, endIndexBottom);

      inActionSettings.marqueePositionBottom++;
      if (inActionSettings.marqueePositionBottom >= titleBottom.length + 4) {
        // Reset after full scroll + padding
        inActionSettings.marqueePositionBottom = 0;
      }
      formattedTitle = `${formattedTitle}\r\n\r\n\r\n${formattedTitleBottom}`;
    }

    // Update last updated timestamp and title
    inActionSettings.status.titleLastUpdated = $NOW;
    if (formattedTitle !== inActionSettings.status.lastTitleValue) {
      inActionSettings.status.lastTitleValue = formattedTitle;
      StreamDeckConnection.setTitle({ context: inContext, title: formattedTitle });
    }
  } else if (
    !inActionSettings?.displayMarqueeTitle &&
    !inActionSettings?.displayMarqueeAlbumTitle &&
    !inActionSettings?.displayStateBasedTitle &&
    inActionSettings.status?.lastTitleValue === undefined
  ) {
    inActionSettings.status.lastTitleValue = null;
    StreamDeckConnection.setTitle({ context: inContext, title: null });
  }
  // (inActionSettings.currentStateIndex !== inFutureStateIndex) &&
  // Update album artwork on Stream Deck button if:
  // - Album art URI has never been cached, or current URI differs from cached URI
  // - Album art display setting is enabled in action settings
  // - Album art URI exists in current track metadata
  if (inActionSettings?.displayAlbumArt) {
    const albumArtURI = customAlbumArt || inSonosSpeakerState?.playing?.albumArtURI;
    if (
      inActionSettings?.status?.albumArtURILastValue === undefined ||
      inActionSettings.status.albumArtURILastValue !== albumArtURI ||
      inActionSettings.currentStateIndex !== inFutureStateIndex
    ) {
      if (albumArtURI) {
        inActionSettings.status.albumArtURILastValue = albumArtURI;
        if (albumArtURI.startsWith("http")) {
          fetch(albumArtURI)
            .then((response) => response.arrayBuffer())
            .then((buffer) => {
              const base64 = Buffer.from(buffer).toString("base64");
              StreamDeckConnection.setImage({
                context: inContext,
                image: `data:image/png;base64,${base64}`,
                state: inFutureStateIndex,
              });
            })
            .catch((error) => console.error("Error fetching albumArtURI:", error));
        } else {
          StreamDeckConnection.setImage({
            context: inContext,
            image: albumArtURI,
            state: inFutureStateIndex,
          });
        }
      } else {
        inActionSettings.status.albumArtURILastValue = null;
        StreamDeckConnection.setImage({
          context: inContext,
          image: null,
          state: inFutureStateIndex,
        });
      }
    }
  } else if (
    inActionSettings?.displayAlbumArt === false &&
    inActionSettings?.status?.albumArtURILastValue === undefined
  ) {
    inActionSettings.status.albumArtURILastValue = null;
    StreamDeckConnection.setImage({
      context: inContext,
      image: null,
      state: inFutureStateIndex,
    });
  } else if (
    inActionSettings?.displayAlbumArt === false &&
    inActionSettings?.status?.albumArtURILastValue !== undefined &&
    inActionSettings.currentStateIndex !== inFutureStateIndex
  ) {
    inActionSettings.status.albumArtURILastValue = null;
    StreamDeckConnection.setImage({
      context: inContext,
      image: null,
      state: inFutureStateIndex,
    });
  }
}

/** Helper functions End */

/**
 * Toggle mute/unmute action
 * @param {string} inContext - The context of the action
 * @param {object} inActionSettings - The settings of the action
 * @param {object} inSonosSpeakerState - The state of the Sonos speaker
 * @param {number} deviceTimeoutDuration - The timeout duration for the action
 * @returns {object} - An object with status, completed, and message properties
 * @property {string} status - The status of the action ("SUCCESS" or "ERROR")
 * @property {boolean} completed - Whether the action was completed successfully
 * @property {string} message - The message describing the action
 * @property {object} updatedSonosSpeakerState - The updated state of the Sonos speaker
 */
export async function toggle_mute_unmute_action({
  inContext,
  inActionSettings,
  inSonosSpeakerState,
  deviceTimeoutDuration = 1,
}) {
  const functionName = "[Toggle Mute/Unmute Action]";
  if (!inSonosSpeakerState) {
    console.log(`${functionName} inSonosSpeakerState is undefined for context ${inContext}`);
    return {
      status: "ERROR",
      completed: false,
      message: `[Toggle Mute/Unmute Action] inSonosSpeakerState is undefined for context ${inContext}`,
    };
  }
  try {
    const isMuted = inSonosSpeakerState?.muted ?? false;
    const newMuteState = !isMuted;

    const sonosController = new SonosController();
    sonosController.connect(inActionSettings.hostAddress);
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Timeout toggling mute")), deviceTimeoutDuration * 1000)
    );
    const setMuteState = await Promise.race([sonosController.setMute(newMuteState), timeout]);

    if (!setMuteState.timedOut) {
      const updatedSonosSpeakerState = { ...inSonosSpeakerState, muted: newMuteState };
      clearTimeout(setMuteState.timedOut);
      return {
        status: "SUCCESS",
        completed: true,
        message: `${functionName} Sonos mute state toggled to: ${newMuteState}`,
        updatedSonosSpeakerState,
      };
    }
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error toggling Sonos mute state for context ${inContext}: ${setMuteState.error.message}`,
    };
  } catch (error) {
    console.error(
      `${functionName} Error toggling Sonos mute state for context ${inContext}:`,
      error
    );
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error toggling Sonos mute state for context ${inContext}: ${error.message}`,
    };
  }
}

/**
 * Toggle mute/unmute state
 * @param {string} inContext - The context of the action
 * @param {object} inActionSettings - The settings of the action
 * @param {object} inSonosSpeakerState - The state of the Sonos speaker
 * @param {object} StreamDeckConnection - The StreamDeck WebSocket Connection
 * @returns {object} - An object with status, completed, and message properties
 * @property {string} status - The status of the action ("SUCCESS" or "ERROR")
 * @property {boolean} completed - Whether the action was completed successfully
 * @property {string} message - The message describing the action
 */
export async function toggle_mute_unmute_state({
  inContext,
  inActionSettings,
  inSonosSpeakerState,
  StreamDeckConnection,
}) {
  const functionName = "[Toggle Mute/Unmute State]";
  if (!inSonosSpeakerState) {
    console.log(`${functionName} inSonosSpeakerState is undefined for context ${inContext}`);
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} inSonosSpeakerState is undefined for context ${inContext}`,
    };
  }
  try {
    const stateName = inSonosSpeakerState.muted ? "Muted" : "Unmuted";
    const futureStateIndex =
      inActionSettings.states.findIndex(
        (state) => state.Name.toLowerCase() === stateName.toLowerCase()
      ) || 0;

    updateStreamDeckStateAndTitle({
      inContext,
      inActionSettings,
      inSonosSpeakerState,
      inFutureStateIndex: futureStateIndex,
      StreamDeckConnection,
    });

    return {
      status: "SUCCESS",
      completed: true,
      message: `${functionName} Sonos mute state toggled to: ${stateName}`,
      futureStateIndex,
    };
  } catch (error) {
    console.error(
      `${functionName} Error updating Sonos mute state for context ${inContext}:`,
      error
    );
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error updating Sonos mute state for context ${inContext}: ${error.message}`,
    };
  }
}

/**
 * Toggle play/pause state
 * @param {string} inContext - The context of the action
 * @param {object} inActionSettings - The settings of the action
 * @param {object} inSonosSpeakerState - The state of the Sonos speaker
 * @param {object} StreamDeckConnection - The StreamDeck WebSocket Connection
 * @returns {object} - An object with status, completed, and message properties
 * @property {string} status - The status of the action ("SUCCESS" or "ERROR")
 * @property {boolean} completed - Whether the action was completed successfully
 * @property {string} message - The message describing the action
 */
export async function toggle_play_pause_state({
  inContext,
  inActionSettings,
  inSonosSpeakerState,
  StreamDeckConnection,
}) {
  const functionName = "[Toggle Play/Pause State]";
  if (!inSonosSpeakerState) {
    console.log(`${functionName} inSonosSpeakerState is undefined for context ${inContext}`);
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} inSonosSpeakerState is undefined for context ${inContext}`,
    };
  }
  try {
    let stateName;
    switch (inSonosSpeakerState.playbackState) {
      case "PLAYING":
        stateName = "Playing";
        break;
      case "PAUSED_PLAYBACK":
        stateName = "Paused";
        break;
      case "STOPPED":
        stateName = "Stopped";
        break;
      default:
        stateName = "Stopped"; // fallback state
    }

    const futureStateIndex =
      inActionSettings.states.findIndex(
        (state) => state.Name.toLowerCase() === stateName.toLowerCase()
      ) || 0;
    // StreamDeckConnection.setState(inContext, stateIndex);
    updateStreamDeckStateAndTitle({
      inContext,
      inActionSettings,
      inSonosSpeakerState,
      inFutureStateIndex: futureStateIndex,
      StreamDeckConnection,
      customTitle: stateName,
    });

    return {
      status: "SUCCESS",
      completed: true,
      message: `${functionName} Sonos playback state set to: ${stateName}`,
      futureStateIndex,
    };
  } catch (error) {
    console.error(
      `${functionName} Error updating Sonos playback state for context ${inContext}:`,
      error
    );
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error updating Sonos playback state for context ${inContext}: ${error.message}`,
    };
  }
}

/**
 * Toggle play/pause action
 * @param {string} inContext - The context of the action
 * @param {object} inActionSettings - The settings of the action
 * @param {object} inSonosSpeakerState - The state of the Sonos speaker
 * @param {number} deviceTimeoutDuration - The timeout duration for the action
 * @returns {object} - An object with status, completed, and message properties
 * @property {string} status - The status of the action ("SUCCESS" or "ERROR")
 * @property {boolean} completed - Whether the action was completed successfully
 * @property {string} message - The message describing the action
 */
export async function toggle_play_pause_action({
  inContext,
  inActionSettings,
  inSonosSpeakerState,
  deviceTimeoutDuration = 1,
}) {
  const functionName = "[Toggle Play/Pause Action]";
  if (!inSonosSpeakerState) {
    console.log(`${functionName} inSonosSpeakerState is undefined for context ${inContext}`);
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} inSonosSpeakerState is undefined for context ${inContext}`,
    };
  }
  try {
    const isPlaying =
      (inSonosSpeakerState == null ? void 0 : inSonosSpeakerState.playbackState) ===
        "PLAYING" ?? false;

    const sonosController = new SonosController();
    sonosController.connect(inActionSettings.hostAddress);
    const timeout = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Timeout controlling playback")),
        deviceTimeoutDuration * 1000
      )
    );
    const setPlayPauseState = await Promise.race([
      isPlaying ? sonosController.pause() : sonosController.play(),
      timeout,
    ]);

    if (!setPlayPauseState.timedOut) {
      const updatedSonosSpeakerState = {
        ...inSonosSpeakerState,
        playbackState: isPlaying ? "PAUSED_PLAYBACK" : "PLAYING",
      };
      clearTimeout(setPlayPauseState.timedOut);
      return {
        status: "SUCCESS",
        completed: true,
        message: `${functionName} Sonos playback state toggled to: ${isPlaying ? "Paused" : "Playing"}`,
        updatedSonosSpeakerState,
      };
    }
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error toggling Sonos playback state for context ${inContext}: ${setPlayPauseState.error.message}`,
    };
  } catch (error) {
    console.error(
      `${functionName} Error toggling Sonos playback state for context ${inContext}:`,
      error
    );
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error toggling Sonos playback state for context ${inContext}: ${error.message}`,
    };
  }
}

/**
 * Toggle play mode between repeat, shuffle and normal
 * @param {string} inContext - The context of the action
 * @param {object} inActionSettings - The settings of the action
 * @param {object} inSonosSpeakerState - The state of the Sonos speaker
 * @param {object} StreamDeckConnection - The Stream Deck connection object
 * @param {number} deviceTimeoutDuration - The timeout duration for the action
 * @returns {object} - An object with status, completed, and message properties
 * @property {string} status - The status of the action ("SUCCESS" or "ERROR")
 * @property {boolean} completed - Whether the action was completed successfully
 * @property {string} message - The message describing the action
 * @property {object} updatedSonosSpeakerState - The updated state of the Sonos speaker
 */
export async function toggle_play_mode_action({
  inContext,
  inActionSettings,
  inSonosSpeakerState,
  deviceTimeoutDuration = 1,
}) {
  const functionName = "[Toggle Play Mode Action]";
  if (!inSonosSpeakerState) {
    console.log(`${functionName} inSonosSpeakerState is undefined for context ${inContext}`);
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} inSonosSpeakerState is undefined for context ${inContext}`,
    };
  }
  try {
    const currentPlayMode = inSonosSpeakerState?.playMode || "NORMAL";

    // If current play mode isn't in selected modes, start from beginning
    const currentIndex = inActionSettings.selectedPlayModes.indexOf(currentPlayMode);
    const nextMode =
      currentIndex === -1
        ? inActionSettings.selectedPlayModes[0] // Start at beginning if current mode not found
        : inActionSettings.selectedPlayModes[
            (currentIndex + 1) % inActionSettings.selectedPlayModes.length
          ];

    const sonosController = new SonosController();
    sonosController.connect(inActionSettings.hostAddress);

    const timeout = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Timeout setting play mode")),
        deviceTimeoutDuration * 1000
      )
    );

    const setPlayModeState = await Promise.race([
      sonosController.setPlayMode(nextMode),
      timeout,
    ]);

    if (!setPlayModeState.timedOut) {
      const updatedSonosSpeakerState = { ...inSonosSpeakerState, playMode: nextMode };
      clearTimeout(setPlayModeState.timedOut);
      return {
        status: "SUCCESS",
        completed: true,
        message: `${functionName} Play mode changed to: ${nextMode}`,
        updatedSonosSpeakerState,
      };
    }
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error setting play mode for context ${inContext}: ${setPlayModeState.error.message}`,
    };
  } catch (error) {
    console.error(`${functionName} Error toggling play mode for context ${inContext}:`, error);
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error toggling play mode for context ${inContext}: ${error.message}`,
    };
  }
}

/**
 * Update play mode state on Stream Deck
 * @param {string} inContext - The context of the action
 * @param {object} inActionSettings - The settings of the action
 * @param {object} inSonosSpeakerState - The state of the Sonos speaker
 * @param {object} StreamDeckConnection - The Stream Deck connection object
 * @returns {object} - Status object indicating success/failure
 */
export async function toggle_play_mode_state({
  inContext,
  inActionSettings,
  inSonosSpeakerState,
  StreamDeckConnection,
}) {
  const functionName = "[Toggle Play Mode State]";
  if (!inSonosSpeakerState) {
    console.log(`${functionName} inSonosSpeakerState is undefined for context ${inContext}`);
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} inSonosSpeakerState is undefined for context ${inContext}`,
    };
  }
  try {
    const playMode = inSonosSpeakerState.playMode || "NORMAL";
    const futureStateIndex =
      inActionSettings.states.findIndex(
        (state) => state.Name.toUpperCase() === playMode.toUpperCase()
      ) || 0;

    // StreamDeckConnection.setState(inContext, stateIndex);
    // Add short title logic
    let customTitle;
    switch (inActionSettings.states[futureStateIndex].Name) {
      case "Shuffle_NoRepeat":
        customTitle = "Shuffle 0";
        break;
      case "Shuffle_Repeat_One":
        customTitle = "Shuffle 1";
        break;
      case "Repeat_One":
        customTitle = "Repeat 1";
        break;
      case "Repeat_All":
        customTitle = "Repeat";
        break;
      default:
        break;
    }

    updateStreamDeckStateAndTitle({
      inContext,
      inActionSettings,
      inSonosSpeakerState,
      inFutureStateIndex: futureStateIndex,
      StreamDeckConnection,
      customTitle,
    });

    return {
      status: "SUCCESS",
      completed: true,
      message: `${functionName} Play mode state updated to: ${playMode}`,
      futureStateIndex,
    };
  } catch (error) {
    console.error(
      `${functionName} Error updating play mode state for context ${inContext}:`,
      error
    );
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error updating play mode state for context ${inContext}: ${error.message}`,
    };
  }
}

/**
 * Toggle input source for Sonos speaker
 * @param {string} inContext - The context of the action
 * @param {object} inActionSettings - The settings of the action
 * @param {object} inSonosSpeakerState - The state of the Sonos speaker
 * @param {number} deviceTimeoutDuration - The timeout duration for the action
 * @returns {object} - Status object indicating success/failure
 * @property {string} status - The status of the action ("SUCCESS" or "ERROR")
 * @property {boolean} completed - Whether the action was completed successfully
 * @property {string} message - The message describing the action
 * @property {object} updatedSonosSpeakerState - The updated state of the Sonos speaker
 */
export async function toggle_input_source_action({
  inContext,
  inActionSettings,
  inSonosSpeakerState,
  deviceTimeoutDuration = 1,
}) {
  const functionName = "[Toggle Input Source Action]";
  if (!inSonosSpeakerState) {
    console.log(`${functionName} inSonosSpeakerState is undefined for context ${inContext}`);
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} inSonosSpeakerState is undefined for context ${inContext}`,
    };
  }

  try {
    const currentURI = inSonosSpeakerState == null ? void 0 : inSonosSpeakerState.currentURI;
    const inputSourceMappings = getInputSourceMappings(currentURI);

    // If current play mode isn't in selected modes, start from beginning
    const currentIndex = inActionSettings.selectedInputSources.indexOf(
      inputSourceMappings.sourceName.toUpperCase()
    );
    const selectNextSource =
      currentIndex === -1
        ? inActionSettings.selectedInputSources[0] // Start at beginning if current mode not found
        : inActionSettings.selectedInputSources[
            (currentIndex + 1) % inActionSettings.selectedInputSources.length
          ];

    const nextSource = inputSourceMappings.generateUri[selectNextSource];

    const sonosController = new SonosController();
    sonosController.connect(inActionSettings.hostAddress);

    const timeout = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Timeout setting input source")),
        deviceTimeoutDuration * 1000
      )
    );

    const setInputSourceState = await Promise.race([
      sonosController.setLocalTransport(nextSource.prefix, nextSource.suffix),
      timeout,
    ]);

    if (!setInputSourceState.timedOut) {
      const updatedSonosSpeakerState = {
        ...inSonosSpeakerState,
        currentURI: `${nextSource.prefix}:${inSonosSpeakerState.uuid}${nextSource.suffix}`,
      };
      clearTimeout(setInputSourceState.timedOut);
      const setPlayModeState = await Promise.race([sonosController.play(), timeout]);
      if (!setPlayModeState.timedOut) {
        return {
          status: "SUCCESS",
          completed: true,
          message: `${functionName} Input source changed to: ${nextSource}`,
          updatedSonosSpeakerState,
        };
      }
      return {
        status: "ERROR",
        completed: false,
        message: `${functionName} Error setting input source for context ${inContext}: ${setPlayModeState.error.message}`,
      };
    }
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error setting input source for context ${inContext}: ${setInputSourceState.error.message}`,
    };
  } catch (error) {
    console.error(
      `${functionName} Error toggling input source for context ${inContext}:`,
      error
    );
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error toggling input source for context ${inContext}: ${error.message}`,
    };
  }
}

/**
 * Update input source state on Stream Deck
 * @param {string} inContext - The context of the action
 * @param {object} inActionSettings - The settings of the action
 * @param {object} inSonosSpeakerState - The state of the Sonos speaker
 * @param {object} StreamDeckConnection - The Stream Deck connection object
 * @returns {object} - Status object indicating success/failure
 */
export async function toggle_input_source_state({
  inContext,
  inActionSettings,
  inSonosSpeakerState,
  StreamDeckConnection,
}) {
  const functionName = "[Toggle Input Source State]";
  if (!inSonosSpeakerState) {
    console.log(`${functionName} inSonosSpeakerState is undefined for context ${inContext}`);
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} inSonosSpeakerState is undefined for context ${inContext}`,
    };
  }
  try {
    const currentURI = inSonosSpeakerState == null ? void 0 : inSonosSpeakerState.currentURI;
    const inputSourceMappings = getInputSourceMappings(currentURI);

    const inputSource = inSonosSpeakerState.inputSource || inActionSettings.states[0].Name;
    const futureStateIndex =
      inActionSettings.selectedInputSources.indexOf(
        inputSourceMappings.sourceName.toUpperCase()
      ) || 0;

    // StreamDeckConnection.setState(inContext, stateIndex);
    // Add short title logic
    let customTitle;
    switch (inActionSettings.states[futureStateIndex].Name) {
      case "Sonos_Queue":
        customTitle = "Queue";
        break;
      case "TV_Input":
        customTitle = "TV";
        break;
      case "Line_In":
        customTitle = "Line-In";
        break;
      default:
        break;
    }

    updateStreamDeckStateAndTitle({
      inContext,
      inActionSettings,
      inSonosSpeakerState,
      inFutureStateIndex: futureStateIndex,
      StreamDeckConnection,
      customTitle,
    });

    return {
      status: "SUCCESS",
      completed: true,
      message: `${functionName} Input source state updated to: ${inputSource}`,
      futureStateIndex,
    };
  } catch (error) {
    console.error(
      `${functionName} Error updating input source state for context ${inContext}:`,
      error
    );
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error updating input source state for context ${inContext}: ${error.message}`,
    };
  }
}

/**
 * Play next track action
 * @param {string} inContext - The context of the action
 * @param {object} inSettings - The settings of the action
 * @param {object} inSonosSpeakerState - The state of the Sonos speaker
 * @param {number} deviceTimeoutDuration - The timeout duration for the action
 * @returns {object} - An object with status, completed, and message properties
 * @property {string} status - The status of the action ("SUCCESS" or "ERROR")
 * @property {boolean} completed - Whether the action was completed successfully
 * @property {string} message - The message describing the action
 * @property {object} updatedSonosSpeakerState - The updated state of the Sonos speaker
 */
export async function play_next_track_action({
  inContext,
  inActionSettings,
  inSonosSpeakerState,
  deviceTimeoutDuration = 1,
}) {
  const functionName = "[Play Next Track Action]";
  if (!inSonosSpeakerState) {
    console.log(`${functionName} inSonosSpeakerState is undefined for context ${inContext}`);
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} inSonosSpeakerState is undefined for context ${inContext}`,
    };
  }
  try {
    const sonosController = new SonosController();
    sonosController.connect(inActionSettings.hostAddress);

    const timeout = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Timeout skipping to next track")),
        deviceTimeoutDuration * 1000
      )
    );

    const nextTrackState = await Promise.race([sonosController.next(), timeout]);
    if (!nextTrackState.timedOut) {
      const updatedSonosSpeakerState = {
        ...inSonosSpeakerState,
        currentTrack: inSonosSpeakerState.currentTrack + 1,
      };
      clearTimeout(nextTrackState.timedOut);
      return {
        status: "SUCCESS",
        completed: true,
        message: `${functionName} Skipped to next track`,
        updatedSonosSpeakerState,
      };
    }
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error skipping to next track for context ${inContext}: ${nextTrackState.error.message}`,
    };
  } catch (error) {
    console.error(
      `${functionName} Error skipping to next track for context ${inContext}:`,
      error
    );
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error skipping to next track for context ${inContext}: ${error.message}`,
    };
  }
}

/**
 * Play previous track action
 * @param {string} inContext - The context of the action
 * @param {object} inActionSettings - The settings of the action
 * @param {object} inSonosSpeakerState - The state of the Sonos speaker
 * @param {number} deviceTimeoutDuration - The timeout duration for the action
 * @returns {object} - An object with status, completed, and message properties
 * @property {string} status - The status of the action ("SUCCESS" or "ERROR")
 * @property {boolean} completed - Whether the action was completed successfully
 * @property {string} message - The message describing the action
 * @property {object} updatedSonosSpeakerState - The updated state of the Sonos speaker
 */
export async function play_previous_track_action({
  inContext,
  inActionSettings,
  inSonosSpeakerState,
  deviceTimeoutDuration = 1,
}) {
  const functionName = "[Play Previous Track Action]";
  if (!inSonosSpeakerState) {
    console.log(`${functionName} inSonosSpeakerState is undefined for context ${inContext}`);
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} inSonosSpeakerState is undefined for context ${inContext}`,
    };
  }
  try {
    const sonosController = new SonosController();
    sonosController.connect(inActionSettings.hostAddress);

    const timeout = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Timeout skipping to previous track")),
        deviceTimeoutDuration * 1000
      )
    );

    const previousTrackState = await Promise.race([sonosController.previous(), timeout]);
    if (!previousTrackState.timedOut) {
      const updatedSonosSpeakerState = {
        ...inSonosSpeakerState,
        currentTrack: inSonosSpeakerState.currentTrack - 1,
      };
      clearTimeout(previousTrackState.timedOut);
      return {
        status: "SUCCESS",
        completed: true,
        message: `${functionName} Skipped to previous track`,
        updatedSonosSpeakerState,
      };
    }
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error skipping to previous track for context ${inContext}: ${previousTrackState.error.message}`,
    };
  } catch (error) {
    console.error(
      `${functionName} Error skipping to previous track for context ${inContext}:`,
      error
    );
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error skipping to previous track for context ${inContext}: ${error.message}`,
    };
  }
}

/**
 * Increase volume action
 * @param {string} inContext - The context of the action
 * @param {object} inActionSettings - The settings of the action
 * @param {object} inSonosSpeakerState - The state of the Sonos speaker
 * @param {number} deviceTimeoutDuration - The timeout duration for the action
 * @returns {object} - An object with status, completed, and message properties
 * @property {string} status - The status of the action ("SUCCESS" or "ERROR")
 * @property {boolean} completed - Whether the action was completed successfully
 * @property {string} message - The message describing the action
 * @property {object} updatedSonosSpeakerState - The updated state of the Sonos speaker
 */
export async function volume_up_action({
  inContext,
  inActionSettings,
  inSonosSpeakerState,
  deviceTimeoutDuration = 1,
}) {
  const functionName = "[Volume Up Action]";
  if (!inSonosSpeakerState) {
    console.log(`${functionName} inSonosSpeakerState is undefined for context ${inContext}`);
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} inSonosSpeakerState is undefined for context ${inContext}`,
    };
  }
  try {
    const sonosController = new SonosController();
    sonosController.connect(inActionSettings.hostAddress);

    const timeout = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Timeout increasing volume")),
        deviceTimeoutDuration * 1000
      )
    );

    const updatedVolume = Math.min(
      100,
      parseInt(inSonosSpeakerState.audioEqualizer.volume) +
        (parseInt(inActionSettings.adjustVolumeIncrement) || 10)
    );

    const volumeUpState = await Promise.race([
      sonosController.setVolume(updatedVolume),
      timeout,
    ]);
    if (!volumeUpState.timedOut) {
      const updatedSonosSpeakerState = {
        ...inSonosSpeakerState,
        audioEqualizer: { ...inSonosSpeakerState.audioEqualizer, volume: updatedVolume },
      };
      clearTimeout(volumeUpState.timedOut);
      return {
        status: "SUCCESS",
        completed: true,
        message: `${functionName} Volume increased to: ${updatedVolume}`,
        updatedSonosSpeakerState,
      };
    }
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error increasing volume for context ${inContext}: ${volumeUpState.error.message}`,
    };
  } catch (error) {
    console.error(`${functionName} Error increasing volume for context ${inContext}:`, error);
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error increasing volume for context ${inContext}: ${error.message}`,
    };
  }
}

/**
 * Decrease volume action
 * @param {string} inContext - The context of the action
 * @param {object} inActionSettings - The settings of the action
 * @param {object} inSonosSpeakerState - The state of the Sonos speaker
 * @param {number} deviceTimeoutDuration - The timeout duration for the action
 * @returns {object} - An object with status, completed, and message properties
 * @property {string} status - The status of the action ("SUCCESS" or "ERROR")
 * @property {boolean} completed - Whether the action was completed successfully
 * @property {string} message - The message describing the action
 * @property {object} updatedSonosSpeakerState - The updated state of the Sonos speaker
 */
export async function volume_down_action({
  inContext,
  inActionSettings,
  inSonosSpeakerState,
  deviceTimeoutDuration = 1,
}) {
  const functionName = "[Volume Down Action]";
  if (!inSonosSpeakerState) {
    console.log(`${functionName} inSonosSpeakerState is undefined for context ${inContext}`);
    return {
      status: "ERROR",
      completed: false,
      message: `inSonosSpeakerState is undefined for context ${inContext}`,
    };
  }
  try {
    const sonosController = new SonosController();
    sonosController.connect(inActionSettings.hostAddress);

    const timeout = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Timeout decreasing volume")),
        deviceTimeoutDuration * 1000
      )
    );

    const updatedVolume = Math.max(
      0,
      parseInt(inSonosSpeakerState.audioEqualizer.volume) -
        (parseInt(inActionSettings.adjustVolumeIncrement) || 10)
    );

    const volumeDownState = await Promise.race([
      sonosController.setVolume(updatedVolume),
      timeout,
    ]);
    if (!volumeDownState.timedOut) {
      const updatedSonosSpeakerState = {
        ...inSonosSpeakerState,
        audioEqualizer: { ...inSonosSpeakerState.audioEqualizer, volume: updatedVolume },
      };
      clearTimeout(volumeDownState.timedOut);
      return {
        status: "SUCCESS",
        completed: true,
        message: `${functionName} Volume decreased to: ${updatedVolume}`,
        updatedSonosSpeakerState,
      };
    }
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error decreasing volume for context ${inContext}: ${volumeDownState.error.message}`,
    };
  } catch (error) {
    console.error(`${functionName} Error decreasing volume for context ${inContext}:`, error);
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error decreasing volume for context ${inContext}: ${error.message}`,
    };
  }
}

/**
 * Equalizer encoder action
 * @param {string} inContext - The context of the action
 * @param {object} inActionSettings - The settings of the action
 * @param {object} inSonosSpeakerState - The state of the Sonos speaker
 * @param {object} inRotation - The rotation of the encoder
 * @param {number} deviceTimeoutDuration - The timeout duration for the action
 * @returns {object} - An object with status, completed, and message properties
 * @property {string} status - The status of the action ("SUCCESS" or "ERROR")
 * @property {boolean} completed - Whether the action was completed successfully
 * @property {string} message - The message describing the action
 * @property {object} updatedSonosSpeakerState - The updated state of the Sonos speaker
 */
export async function encoder_audio_equalizer_action({
  inContext,
  inActionSettings,
  inSonosSpeakerState,
  inRotation,
  deviceTimeoutDuration = 1,
}) {
  const functionName = "[Encoder Audio Equalizer Action]";
  if (!inSonosSpeakerState) {
    console.log(`${functionName} inSonosSpeakerState is undefined for context ${inContext}`);
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} inSonosSpeakerState is undefined for context ${inContext}`,
    };
  }
  try {
    const sonosController = new SonosController();
    sonosController.connect(inActionSettings.hostAddress);

    const timeout = new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `Timeout setting equalizer value for ${inActionSettings.encoderAudioEqualizerTarget}`
            )
          ),
        deviceTimeoutDuration * 1000
      )
    );

    switch (inActionSettings.encoderAudioEqualizerTarget) {
      case "BASS": {
        const updatedBass = Math.min(
          10,
          Math.max(
            -10,
            parseInt(inSonosSpeakerState.audioEqualizer.bass) + parseInt(inRotation.ticks)
          )
        );
        const bassState = await Promise.race([sonosController.setBass(updatedBass), timeout]);
        if (!bassState.timedOut) {
          const updatedSonosSpeakerState = {
            ...inSonosSpeakerState,
            audioEqualizer: { ...inSonosSpeakerState.audioEqualizer, bass: updatedBass },
          };
          clearTimeout(bassState.timedOut);
          return {
            status: "SUCCESS",
            completed: true,
            message: `${functionName} Bass set to: ${updatedBass}`,
            updatedSonosSpeakerState,
          };
        }
        break;
      }
      case "TREBLE": {
        const updatedTreble = Math.min(
          10,
          Math.max(
            -10,
            parseInt(inSonosSpeakerState.audioEqualizer.treble) + parseInt(inRotation.ticks)
          )
        );
        const trebleState = await Promise.race([
          sonosController.setTreble(updatedTreble),
          timeout,
        ]);
        if (!trebleState.timedOut) {
          const updatedSonosSpeakerState = {
            ...inSonosSpeakerState,
            audioEqualizer: { ...inSonosSpeakerState.audioEqualizer, treble: updatedTreble },
          };
          clearTimeout(trebleState.timedOut);
          return {
            status: "SUCCESS",
            completed: true,
            message: `${functionName} Treble set to: ${updatedTreble}`,
            updatedSonosSpeakerState,
          };
        }
        break;
      }
      case "VOLUME": {
        const updatedVolume = Math.min(
          100,
          Math.max(
            0,
            parseInt(inSonosSpeakerState.audioEqualizer.volume) + parseInt(inRotation.ticks)
          )
        );
        const volumeState = await Promise.race([
          sonosController.setVolume(updatedVolume),
          timeout,
        ]);
        if (!volumeState.timedOut) {
          const updatedSonosSpeakerState = {
            ...inSonosSpeakerState,
            audioEqualizer: { ...inSonosSpeakerState.audioEqualizer, volume: updatedVolume },
          };
          clearTimeout(volumeState.timedOut);
          return {
            status: "SUCCESS",
            completed: true,
            message: `${functionName} Volume set to: ${updatedVolume}`,
            updatedSonosSpeakerState,
          };
        }
        break;
      }
      default:
        return {
          status: "ERROR",
          completed: false,
          message: `${functionName} Invalid equalizer action for context ${inContext}`,
        };
    }
  } catch (error) {
    console.error(
      `${functionName} Error updating equalizer state for context ${inContext}:`,
      error
    );
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error updating equalizer state for context ${inContext}: ${error.message}`,
    };
  }
}

/**
 * Equalizer encoder action
 * @param {string} inContext - The context of the action
 * @param {object} inActionSettings - The settings of the action
 * @param {object} inSonosSpeakerState - The state of the Sonos speaker
 * @param {object} StreamDeckConnection - The Stream Deck connection object
 * @returns {object} - An object with status, completed, and message properties
 */
export async function encoder_audio_equalizer_state({
  inContext,
  inActionSettings,
  inSonosSpeakerState,
  StreamDeckConnection,
}) {
  const functionName = "[Encoder Audio Equalizer State]";
  if (!inSonosSpeakerState) {
    console.log(`${functionName} inSonosSpeakerState is undefined for context ${inContext}`);
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} inSonosSpeakerState is undefined for context ${inContext}`,
    };
  }
  try {
    inActionSettings.status = inActionSettings.status || {};

    const lastAudioEqualizerVolume = inSonosSpeakerState.audioEqualizer.volume;
    const lastAudioEqualizerBass = inSonosSpeakerState.audioEqualizer.bass;
    const lastAudioEqualizerTreble = inSonosSpeakerState.audioEqualizer.treble;

    switch (inActionSettings.encoderAudioEqualizerTarget) {
      case "BASS":
        if (inActionSettings.status.lastAudioEqualizerBass !== lastAudioEqualizerBass) {
          if (
            inActionSettings.status.lastAudioEqualizerLayout !==
            "./layouts/encoder-gbar-10-10.json"
          ) {
            StreamDeckConnection.setFeedbackLayout({
              context: inContext,
              payload: {
                layout: "./layouts/encoder-gbar-10-10.json",
              },
            });
          }
          StreamDeckConnection.setFeedback({
            context: inContext,
            payload: {
              title: { value: inActionSettings.encoderAudioEqualizerTarget },
              value: { value: lastAudioEqualizerBass },
              indicator: { value: lastAudioEqualizerBass },
            },
          });
          inActionSettings.status.lastAudioEqualizerBass = lastAudioEqualizerBass;
          inActionSettings.status.lastAudioEqualizerLayout =
            "./layouts/encoder-gbar-10-10.json";
        }
        break;
      case "TREBLE":
        if (inActionSettings.status.lastAudioEqualizerTreble !== lastAudioEqualizerTreble) {
          if (
            inActionSettings.status.lastAudioEqualizerLayout !==
            "./layouts/encoder-gbar-10-10.json"
          ) {
            StreamDeckConnection.setFeedbackLayout({
              context: inContext,
              payload: {
                layout: "./layouts/encoder-gbar-10-10.json",
              },
            });
          }
          StreamDeckConnection.setFeedback({
            context: inContext,
            payload: {
              title: { value: inActionSettings.encoderAudioEqualizerTarget },
              value: { value: lastAudioEqualizerTreble },
              indicator: { value: lastAudioEqualizerTreble },
            },
          });
          inActionSettings.status.lastAudioEqualizerTreble = lastAudioEqualizerTreble;
          inActionSettings.status.lastAudioEqualizerLayout =
            "./layouts/encoder-gbar-10-10.json";
        }
        break;
      case "VOLUME":
        if (inActionSettings.status.lastAudioEqualizerVolume !== lastAudioEqualizerVolume) {
          if (
            inActionSettings.status.lastAudioEqualizerLayout !==
            "./layouts/encoder-bar-0-100.json"
          ) {
            StreamDeckConnection.setFeedbackLayout({
              context: inContext,
              payload: {
                layout: "./layouts/encoder-bar-0-100.json",
              },
            });
          }
          StreamDeckConnection.setFeedback({
            context: inContext,
            payload: {
              title: { value: inActionSettings.encoderAudioEqualizerTarget },
              value: { value: lastAudioEqualizerVolume },
              indicator: { value: lastAudioEqualizerVolume },
            },
          });
          inActionSettings.status.lastAudioEqualizerVolume = lastAudioEqualizerVolume;
          inActionSettings.status.lastAudioEqualizerLayout = "./layouts/encoder-bar-0-100.json";
        }
        break;
    }

    return {
      status: "SUCCESS",
      completed: true,
      message: `${functionName} Equalizer state updated for ${inActionSettings.encoderAudioEqualizerTarget}`,
      futureStateIndex: 0,
    };
  } catch (error) {
    console.error(
      `${functionName} Error updating equalizer state for context ${inContext}:`,
      error
    );
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error updating equalizer state for context ${inContext}: ${error.message}`,
    };
  }
}

/**
 * Play Sonos favorite action
 * @param {string} inContext - The context of the action
 * @param {object} inActionSettings - The settings of the action
 * @param {object} inSonosSpeakerState - The state of the Sonos speaker
 * @param {number} deviceTimeoutDuration - The timeout duration for the action
 * @returns {object} - An object with status, completed, and message properties
 * @property {string} status - The status of the action ("SUCCESS" or "ERROR")
 * @property {boolean} completed - Whether the action was completed successfully
 * @property {string} message - The message describing the action
 * @property {object} updatedSonosSpeakerState - The updated state of the Sonos speaker
 */
export async function play_sonos_favorite_action({
  inContext,
  inActionSettings,
  inSonosSpeakerState,
  deviceTimeoutDuration = 1,
}) {
  const functionName = "[Play Sonos Favorite Action]";
  if (!inActionSettings?.selectedSonosFavorite) {
    console.log(`${functionName} inSonosSpeakerState is undefined for context ${inContext}`);
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} inSonosSpeakerState is undefined for context ${inContext}`,
    };
  }

  try {
    const sonosController = new SonosController();
    sonosController.connect(inActionSettings.hostAddress);
    const favorite = inActionSettings.selectedSonosFavorite;

    const timeout = (sonosAction) =>
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(`Timeout while ${sonosAction} after ${deviceTimeoutDuration} seconds`)
            ),
          deviceTimeoutDuration * 1e3
        )
      );
    const removeAllTracksFromQueue = await Promise.race([
      sonosController.removeAllTracksFromQueue(),
      timeout("removing all tracks from queue"),
    ]);

    if (!removeAllTracksFromQueue.timedOut) {
      clearTimeout(removeAllTracksFromQueue.timedOut);
      const playFavoriteState = await Promise.race([
        sonosController.setServiceURI({ uri: favorite.uri, metadata: favorite.metadata }),
        timeout("playing favorite"),
      ]);

      if (!playFavoriteState.timedOut) {
        clearTimeout(playFavoriteState.timedOut);
        const setStartPlayingState = await Promise.race([
          sonosController.play(),
          timeout("setting start playing state"),
        ]);
        if (!setStartPlayingState.timedOut) {
          const updatedSonosSpeakerState = { ...inSonosSpeakerState };
          clearTimeout(setStartPlayingState.timedOut);
          return {
            status: "SUCCESS",
            completed: true,
            message: `${functionName} Started playing Sonos favorite`,
            updatedSonosSpeakerState,
          };
        }
      }
    }

    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error playing Sonos favorite for context ${inContext}: ${removeAllTracksFromQueue.timedOut}`,
    };
  } catch (error) {
    console.error(
      `${functionName} Error playing Sonos favorite for context ${inContext}:`,
      error
    );
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error playing Sonos favorite for context ${inContext}: ${error.message}`,
    };
  }
}

/**
 * Play Sonos favorite state
 * @param {string} inContext - The context of the action
 * @param {object} inActionSettings - The settings of the action
 * @param {object} inSonosSpeakerState - The state of the Sonos speaker
 * @param {object} StreamDeckConnection - The Stream Deck connection object
 * @returns {object} - An object with status, completed, and message properties
 */
export async function play_sonos_favorite_state({
  inContext,
  inActionSettings,
  inSonosSpeakerState,
  StreamDeckConnection,
}) {
  const functionName = "[Play Sonos Favorite State]";
  if (!inSonosSpeakerState) {
    console.log(`${functionName} inSonosSpeakerState is undefined for context ${inContext}`);
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} inSonosSpeakerState is undefined for context ${inContext}`,
    };
  }

  try {
    const albumArtURI = inActionSettings.selectedSonosFavorite.albumArtURI || null;
    updateStreamDeckStateAndTitle({
      inContext,
      inActionSettings,
      inSonosSpeakerState,
      StreamDeckConnection,
      customTitle: inActionSettings.selectedSonosFavorite.title,
      customAlbumArt: albumArtURI,
    });

    return {
      status: "SUCCESS",
      completed: true,
      message: `${functionName} Updated play favorite state`,
      futureStateIndex: 0,
    };
  } catch (error) {
    console.error(
      `${functionName} Error updating play favorite state for context ${inContext}:`,
      error
    );
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error updating play favorite state for context ${inContext}: ${error.message}`,
    };
  }
}

/**
 * Refresh device state action
 * @param {string} inContext - The context of the action
 * @param {object} inActionSettings - The settings of the action
 * @param {object} inSonosSpeakerState - The state of the Sonos speaker
 * @param {object} StreamDeckConnection - The Stream Deck connection object
 * @returns {object} - An object with status, completed, and message properties
 */
export async function refresh_speaker_state_action({
  inContext,
  inActionSettings,
  inSonosSpeakerState,
  deviceTimeoutDuration = 1,
}) {
  const functionName = "[Refresh Speaker State Action]";
  if (!inSonosSpeakerState) {
    console.log(`${functionName} inSonosSpeakerState is undefined for context ${inContext}`);
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} inSonosSpeakerState is undefined for context ${inContext}`,
    };
  }
  try {
    const sonosController = new SonosController();
    sonosController.connect(inActionSettings.hostAddress);

    const timeout = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Timeout getting devices")),
        deviceTimeoutDuration * 1000
      )
    );

    const updatedSonosSpeakerState = await Promise.race([
      sonosController.getDeviceInfo(),
      timeout,
    ]);

    if (!updatedSonosSpeakerState.timedOut) {
      clearTimeout(updatedSonosSpeakerState.timedOut);

      return {
        status: "SUCCESS",
        completed: true,
        message: `${functionName} Refreshed device state for ${inActionSettings.speakerKey}`,
        updatedSonosSpeakerState,
      };
    }
  } catch (error) {
    console.error(
      `${functionName} Error refreshing device state for context ${inContext}:`,
      error
    );
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error refreshing device state for context ${inContext}: ${error.message}`,
    };
  }
}

/**
 * Currently playing state
 * @param {string} inContext - The context of the action
 * @param {object} inActionSettings - The settings of the action
 * @param {object} inSonosSpeakerState - The state of the Sonos speaker
 * @param {object} StreamDeckConnection - The Stream Deck connection object
 * @returns {object} - An object with status, completed, and message properties
 */
export async function currently_playing_state({
  inContext,
  inActionSettings,
  inSonosSpeakerState,
  StreamDeckConnection,
}) {
  const functionName = "[Currently Playing State]";
  if (!inSonosSpeakerState) {
    console.log(`${functionName} inSonosSpeakerState is undefined for context ${inContext}`);
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} inSonosSpeakerState is undefined for context ${inContext}`,
    };
  }
  try {
    const currentURI = inSonosSpeakerState == null ? void 0 : inSonosSpeakerState.currentURI;
    const inputSourceMappings = getInputSourceMappings(currentURI);
    let customTitle = null;
    let customAlbumArt = null;
    // if (inputSourceMappings.sourceName !== "TV_Input" && inputSourceMappings.sourceName !== "Line_In") {
    //   customTitle = inSonosSpeakerState.playing?.title;
    //   customAlbumArt = inSonosSpeakerState.playing?.albumArt;
    // } else {
    switch (inputSourceMappings.sourceName) {
      case "TV_Input":
        customTitle = "TV";
        customAlbumArt = "./images/keys/input_tv.png";
        break;
      case "Line_In":
        customTitle = "Line In";
        customAlbumArt = "./images/keys/input_line_in.png";
        break;
      default:
        customTitle = "Queue";
        customAlbumArt = inSonosSpeakerState.playing?.albumArt;
        break;
      // }
    }

    updateStreamDeckStateAndTitle({
      inContext,
      inActionSettings,
      inSonosSpeakerState,
      StreamDeckConnection,
      customTitle,
      customAlbumArt,
    });
    return {
      status: "SUCCESS",
      completed: true,
      message: `${functionName} Updated currently playing state`,
      futureStateIndex: 0,
    };
  } catch (error) {
    console.error(
      `${functionName} Error updating currently playing state for context ${inContext}:`,
      error
    );
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} Error updating currently playing state for context ${inContext}: ${error.message}`,
    };
  }
}

/**
 * Generic state
 * @param {string} inContext - The context of the action
 * @param {object} inActionSettings - The settings of the action
 * @param {object} inSonosSpeakerState - The state of the Sonos speaker
 * @param {object} StreamDeckConnection - The Stream Deck connection object
 * @returns {object} - An object with status, completed, and message properties
 */
export async function generic_state({
  inContext,
  inActionSettings,
  inSonosSpeakerState,
  StreamDeckConnection,
}) {
  const functionName = "[Generic State]";
  if (!inSonosSpeakerState) {
    console.log(`${functionName} inSonosSpeakerState is undefined for context ${inContext}`);
    return {
      status: "ERROR",
      completed: false,
      message: `${functionName} inSonosSpeakerState is undefined for context ${inContext}`,
    };
  }
  const stateName = inActionSettings.states[inActionSettings.currentStateIndex].Name;
  let customTitle = stateName.split("_");
  if (customTitle.length > 1) {
    let customTitleTop =
      customTitle[0].charAt(0).toUpperCase() + customTitle[0].slice(1).toLowerCase();
    if (customTitleTop.length < 10) {
      customTitleTop = customTitleTop
        .padStart((10 + customTitleTop.length) / 2, " ")
        .padEnd(9, " ");
    }
    let customTitleBottom =
      customTitle[1].charAt(0).toUpperCase() + customTitle[1].slice(1).toLowerCase();
    if (customTitleBottom.length < 10) {
      customTitleBottom = customTitleBottom
        .padStart((10 + customTitleBottom.length) / 2, " ")
        .padEnd(9, " ");
    }
    customTitle = `${customTitleTop}\r\n\r\n\r\n${customTitleBottom}`;
  } else {
    customTitle = stateName.charAt(0).toUpperCase() + stateName.slice(1).toLowerCase();
    if (customTitle.length < 10) {
      customTitle = customTitle.padStart((10 + customTitle.length) / 2, " ").padEnd(9, " ");
    }
  }

  updateStreamDeckStateAndTitle({
    inContext,
    inActionSettings,
    inSonosSpeakerState,
    StreamDeckConnection,
    customTitle,
  });
  return {
    status: "SUCCESS",
    completed: true,
    message: `${functionName} Updated generic state`,
    futureStateIndex: 0,
  };
}
