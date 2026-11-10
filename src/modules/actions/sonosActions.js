import { actionFunctionMap } from "../plugin/actionDispatcher.js";
import { buildMarqueeRenderIntent, composeKeyTitle, albumArtImage } from "../plugin/marquee.js";
import { queueItems } from "../plugin/queueCache.js";
import { buildFavoriteRenderIntent } from "../plugin/favoriteKeys.js";
import { isQueueFavorite } from "../common/favoriteSettings.js";
import { getInputSourceMappings } from "../common/uriTaxonomy.js";
import { CAROUSEL_LAYOUT, carouselFeedback, messageFeedback, pendingTicks, slideNext, wrapIndex } from "../plugin/carousel.js";
import {
  makeController,
  raceWithTimeout,
  PLAY_MODES,
  INPUT_SOURCES,
  INPUT_SOURCE_PREFIX,
  resolveVolumeIncrement,
  EQ_LAYOUTS,
  PLAY_MODE_DISPLAY,
} from "./helpers.js";

// Title casing helper: "SHUFFLE_NOREPEAT" → "Shuffle Norepeat"
function titleCase(str) {
  return str
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

// Helper to get state-based title if enabled
function getStateBasedTitle(inActionSettings, label) {
  return inActionSettings.displayStateBasedTitle === true ? label : null;
}

// Helper to get next index with wraparound
function getNextIndex(current, allowedList) {
  const idx = allowedList.indexOf(current);
  return idx === -1 ? 0 : (idx + 1) % allowedList.length;
}

// Helper to build projection for currently-playing action
function buildCurrentlyPlayingProjection(transportInfo, positionInfo, muted, volume, bass, treble) {
  return {
    playbackState: transportInfo?.playbackState,
    muted,
    audioEqualizer: {
      volume,
      bass,
      treble,
    },
    currentURI: positionInfo?.trackURI,
    playing: {
      title: positionInfo?.title,
      artist: positionInfo?.artist,
      album: positionInfo?.album,
      albumArtURI: positionInfo?.albumArtURI,
    },
  };
}

// Helper to build projection for input source toggle
function buildInputSourceProjection(uuid, nextSource) {
  const [prefix, suffix] = INPUT_SOURCE_PREFIX[nextSource.toUpperCase()];
  return {
    currentURI: `${prefix}${uuid}${suffix}`,
    playbackState: "PLAYING",
  };
}

// Clamp helper
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Action 1: Currently Playing
async function currentlyPlayingKeyDown({ inActionSettings }) {
  try {
    const controller = makeController(inActionSettings.hostAddress, inActionSettings.uuid);

    const [transportInfo, positionInfo, muted, volume, bass, treble] = await Promise.all([
      raceWithTimeout(controller.getTransportInfo(), "getTransportInfo"),
      raceWithTimeout(controller.getPositionInfo(), "getPositionInfo"),
      raceWithTimeout(controller.getMute(), "getMute"),
      raceWithTimeout(controller.getVolume(), "getVolume"),
      raceWithTimeout(controller.getBass(), "getBass"),
      raceWithTimeout(controller.getTreble(), "getTreble"),
    ]);

    const projection = buildCurrentlyPlayingProjection(transportInfo, positionInfo, muted, volume, bass, treble);

    return { status: "SUCCESS", updatedSonosSpeakerState: projection };
  } catch (e) {
    console.warn("currentlyPlayingKeyDown error:", e);
    return { status: "ERROR" };
  }
}

function currentlyPlayingState({ inActionSettings, inSonosSpeakerState, advanceMarquee }) {
  return buildMarqueeRenderIntent({ inActionSettings, inSonosSpeakerState, advanceMarquee });
}

// Action 2: Toggle Mute
async function toggleMuteKeyDown({ inActionSettings, inSonosSpeakerState }) {
  try {
    const controller = makeController(inActionSettings.hostAddress, inActionSettings.uuid);
    const desired = !(inSonosSpeakerState?.muted === true);

    await raceWithTimeout(controller.setMute(desired), "setMute");

    return { status: "SUCCESS", updatedSonosSpeakerState: { muted: desired } };
  } catch (e) {
    console.warn("toggleMuteKeyDown error:", e);
    return { status: "ERROR" };
  }
}

function toggleMuteState({ inActionSettings, inSonosSpeakerState }) {
  const muted = inSonosSpeakerState?.muted ?? false;
  const stateIndex = muted ? 1 : 0;
  const title = getStateBasedTitle(inActionSettings, muted ? "Muted" : "Unmuted");

  return { stateIndex, title };
}

// Action 3: Toggle Play/Pause
async function togglePlayPauseKeyDown({ inActionSettings, inSonosSpeakerState }) {
  try {
    const controller = makeController(inActionSettings.hostAddress, inActionSettings.uuid);
    const raw = inSonosSpeakerState?.playbackState || "STOPPED";
    const playbackState = raw === "TRANSITIONING" ? "PLAYING" : raw;

    if (playbackState === "PLAYING") {
      await raceWithTimeout(controller.pause(), "pause");
    } else {
      await raceWithTimeout(controller.play(), "play");
    }

    const projectedState = playbackState === "PLAYING" ? "PAUSED_PLAYBACK" : "PLAYING";

    return { status: "SUCCESS", updatedSonosSpeakerState: { playbackState: projectedState } };
  } catch (e) {
    console.warn("togglePlayPauseKeyDown error:", e);
    return { status: "ERROR" };
  }
}

function togglePlayPauseState({ inActionSettings, inSonosSpeakerState, advanceMarquee }) {
  const raw = inSonosSpeakerState?.playbackState || "STOPPED";
  const playbackState = raw === "TRANSITIONING" ? "PLAYING" : raw;
  const marquee = buildMarqueeRenderIntent({ inActionSettings, inSonosSpeakerState, advanceMarquee });

  let stateIndex;
  let label;

  if (playbackState === "PLAYING") {
    stateIndex = 1;
    label = "Playing";
  } else if (playbackState === "STOPPED") {
    stateIndex = 2;
    label = "Stopped";
  } else {
    stateIndex = 0;
    label = "Paused";
  }

  if (inActionSettings.displayStateBasedTitle === true) {
    // State label on the top row, then the track title, album on the bottom row. The album marquee
    // used to be dropped whenever the state label was on (sonos-9at).
    return {
      stateIndex,
      imageDataURL: marquee.imageDataURL,
      title: composeKeyTitle({ top: label, middle: marquee.titleLine ?? "", bottom: marquee.albumLine ?? "" }),
      titleSource: marquee.titleSource ?? null,
    };
  } else {
    return {
      stateIndex,
      imageDataURL: marquee.imageDataURL,
      title: marquee.title,
      titleSource: marquee.titleSource,
    };
  }
}

// Action 4: Toggle Play Mode
async function togglePlayModeKeyDown({ inActionSettings, inSonosSpeakerState }) {
  try {
    const controller = makeController(inActionSettings.hostAddress, inActionSettings.uuid);

    const allowed =
      inActionSettings.selectedPlayModes && inActionSettings.selectedPlayModes.length > 0
        ? inActionSettings.selectedPlayModes
        : PLAY_MODES;
    const current = inSonosSpeakerState?.playMode || "NORMAL";
    const next = allowed[getNextIndex(current, allowed)];

    await raceWithTimeout(controller.setPlayMode(next), "setPlayMode");

    return { status: "SUCCESS", updatedSonosSpeakerState: { playMode: next } };
  } catch (e) {
    console.warn("togglePlayModeKeyDown error:", e);
    return { status: "ERROR" };
  }
}

function togglePlayModeState({ inActionSettings, inSonosSpeakerState }) {
  const current = inSonosSpeakerState?.playMode || "NORMAL";
  const idx = PLAY_MODES.indexOf(current);
  const stateIndex = idx === -1 ? 0 : idx;
  const modeLabel = titleCase(current);

  const title = getStateBasedTitle(inActionSettings, modeLabel);

  return { stateIndex, title };
}

// Action 5: Toggle Input Source
async function toggleInputSourceKeyDown({ inActionSettings, inSonosSpeakerState }) {
  try {
    const controller = makeController(inActionSettings.hostAddress, inActionSettings.uuid);

    const currentSource = getInputSourceMappings(inSonosSpeakerState?.currentURI ?? "").currentSource;
    const allowed =
      inActionSettings.selectedInputSources && inActionSettings.selectedInputSources.length > 0
        ? inActionSettings.selectedInputSources
        : INPUT_SOURCES;

    const next = allowed[getNextIndex(currentSource, allowed)];

    const [prefix, suffix] = INPUT_SOURCE_PREFIX[next.toUpperCase()];
    // Strip trailing colon from prefix before calling setLocalTransport
    await raceWithTimeout(controller.setLocalTransport(prefix.slice(0, -1), suffix), "setLocalTransport");

    const projection = buildInputSourceProjection(inActionSettings.uuid, next);

    return { status: "SUCCESS", updatedSonosSpeakerState: projection };
  } catch (e) {
    console.warn("toggleInputSourceKeyDown error:", e);
    return { status: "ERROR" };
  }
}

function toggleInputSourceState({ inActionSettings, inSonosSpeakerState }) {
  const currentSource = getInputSourceMappings(inSonosSpeakerState?.currentURI ?? "").currentSource;
  const up = currentSource?.toUpperCase() ?? "SONOS_QUEUE";
  const stateIndex = { SONOS_QUEUE: 0, TV_INPUT: 1, LINE_IN: 2 }[up] ?? 0;
  // Short labels: "Sonos Queue" (11 chars) overflowed the key and was cropped to "nos Que".
  const label = { SONOS_QUEUE: "Queue", TV_INPUT: "TV Input", LINE_IN: "Line In" }[up] ?? titleCase(currentSource);
  const title = getStateBasedTitle(inActionSettings, label);

  return { stateIndex, title };
}

// Action 6: Play Next Track
async function playNextTrackKeyDown({ inActionSettings }) {
  try {
    const controller = makeController(inActionSettings.hostAddress, inActionSettings.uuid);

    await raceWithTimeout(controller.next(), "next");

    return { status: "SUCCESS", updatedSonosSpeakerState: {} };
  } catch (e) {
    console.warn("playNextTrackKeyDown error:", e);
    return { status: "ERROR" };
  }
}

function playNextTrackState({ inActionSettings }) {
  const title = getStateBasedTitle(inActionSettings, "Next");
  return { title };
}

// Action 7: Play Previous Track
async function playPreviousTrackKeyDown({ inActionSettings }) {
  try {
    const controller = makeController(inActionSettings.hostAddress, inActionSettings.uuid);

    await raceWithTimeout(controller.previous(), "previous");

    return { status: "SUCCESS", updatedSonosSpeakerState: {} };
  } catch (e) {
    console.warn("playPreviousTrackKeyDown error:", e);
    return { status: "ERROR" };
  }
}

function playPreviousTrackState({ inActionSettings }) {
  const title = getStateBasedTitle(inActionSettings, "Previous");
  return { title };
}

/**
 * Current volume/bass/treble for a relative adjustment. Before the first poll the state has no
 * value; treating it as 0 made Volume Up send an absolute SetVolume(increment), which could drop a
 * loud speaker to ~10 (sonos-63d). Read it from the speaker instead.
 */
async function currentLevel(controller, inSonosSpeakerState, band) {
  const known = inSonosSpeakerState?.audioEqualizer?.[band];
  if (typeof known === "number" && Number.isFinite(known)) return known;
  const getter = { volume: "getVolume", bass: "getBass", treble: "getTreble" }[band];
  const value = Number(await raceWithTimeout(controller[getter](), getter));
  if (!Number.isFinite(value)) throw new Error(`Unknown current ${band}`);
  return value;
}

// Action 8: Volume Up
async function volumeUpKeyDown({ inActionSettings, inSonosSpeakerState }) {
  try {
    const controller = makeController(inActionSettings.hostAddress, inActionSettings.uuid);
    const increment = resolveVolumeIncrement(inActionSettings);
    const current = await currentLevel(controller, inSonosSpeakerState, "volume");
    const next = Math.min(100, current + increment);

    await raceWithTimeout(controller.setVolume(next), "setVolume");

    return { status: "SUCCESS", updatedSonosSpeakerState: { audioEqualizer: { volume: next } } };
  } catch (e) {
    console.warn("volumeUpKeyDown error:", e);
    return { status: "ERROR" };
  }
}

function volumeUpState({ inActionSettings, inSonosSpeakerState }) {
  const volume = inSonosSpeakerState?.audioEqualizer?.volume;
  const title = getStateBasedTitle(inActionSettings, `Vol ${volume ?? "—"}`);
  return { title };
}

// Action 9: Volume Down
async function volumeDownKeyDown({ inActionSettings, inSonosSpeakerState }) {
  try {
    const controller = makeController(inActionSettings.hostAddress, inActionSettings.uuid);
    const increment = resolveVolumeIncrement(inActionSettings);
    const current = await currentLevel(controller, inSonosSpeakerState, "volume");
    const next = Math.max(0, current - increment);

    await raceWithTimeout(controller.setVolume(next), "setVolume");

    return { status: "SUCCESS", updatedSonosSpeakerState: { audioEqualizer: { volume: next } } };
  } catch (e) {
    console.warn("volumeDownKeyDown error:", e);
    return { status: "ERROR" };
  }
}

function volumeDownState({ inActionSettings, inSonosSpeakerState }) {
  const volume = inSonosSpeakerState?.audioEqualizer?.volume;
  const title = getStateBasedTitle(inActionSettings, `Vol ${volume ?? "—"}`);
  return { title };
}

// Action 10: Play Sonos Favorite
async function playSonosFavoriteKeyDown({ inActionSettings }) {
  try {
    const fav = inActionSettings.selectedSonosFavorite;
    if (!fav?.uri) {
      return { status: "ERROR" };
    }

    const controller = makeController(inActionSettings.hostAddress, inActionSettings.uuid);

    await raceWithTimeout(controller.setServiceURI(fav), "setServiceURI");

    // Record which favorite now owns the speaker. For queue favorites the signature must be read
    // AFTER the load completes, otherwise it is stale immediately (sonos-gw5).
    if (!isQueueFavorite(fav)) {
      return {
        status: "SUCCESS",
        updatedSonosSpeakerState: {
          playbackState: "PLAYING",
          currentURI: fav.uri,
          mediaURI: fav.uri,
          queueSignature: null,
          loadedFavorite: { uri: fav.uri, signature: null },
        },
      };
    }

    let signature = null;
    try {
      signature = await raceWithTimeout(controller.getQueueSignature(), "getQueueSignature");
    } catch (e) {
      console.warn("playSonosFavoriteKeyDown: queue signature unavailable", e);
    }
    return {
      status: "SUCCESS",
      updatedSonosSpeakerState: {
        playbackState: "PLAYING",
        mediaURI: `x-rincon-queue:${inActionSettings.uuid}#0`,
        // The previous favorite's track is no longer playing; the immediate re-poll fills this in.
        playing: { title: "", artist: "", album: "", albumArtURI: "" },
        queueSignature: signature,
        loadedFavorite: { uri: fav.uri, signature },
      },
    };
  } catch (e) {
    console.warn("playSonosFavoriteKeyDown error:", e);
    return { status: "ERROR" };
  }
}

function playSonosFavoriteState({ inActionSettings, inSonosSpeakerState, advanceMarquee }) {
  return buildFavoriteRenderIntent({ inActionSettings, inSonosSpeakerState, advanceMarquee });
}

// Action 11: Encoder Audio Equalizer
async function encoderAudioEqualizerDialRotate({ inActionSettings, inSonosSpeakerState, inRotation }) {
  try {
    const controller = makeController(inActionSettings.hostAddress, inActionSettings.uuid);
    const target = inActionSettings.encoderAudioEqualizerTarget || "VOLUME";
    const band = target.toLowerCase();
    const current = await currentLevel(controller, inSonosSpeakerState, band);

    let next;
    if (target === "VOLUME") {
      next = clamp(current + (inRotation ?? 0), 0, 100);
    } else {
      next = clamp(current + (inRotation ?? 0), -10, 10);
    }

    let call;
    let label;
    if (target === "VOLUME") {
      call = controller.setVolume(next);
      label = "setVolume";
    } else if (target === "BASS") {
      call = controller.setBass(next);
      label = "setBass";
    } else if (target === "TREBLE") {
      call = controller.setTreble(next);
      label = "setTreble";
    } else {
      return { status: "ERROR" };
    }

    await raceWithTimeout(call, label);

    return { status: "SUCCESS", updatedSonosSpeakerState: { audioEqualizer: { [band]: next } } };
  } catch (e) {
    console.warn("encoderAudioEqualizerDialRotate error:", e);
    return { status: "ERROR" };
  }
}

async function encoderAudioEqualizerTouchTap({ inActionSettings }) {
  try {
    const controller = makeController(inActionSettings.hostAddress, inActionSettings.uuid);

    const [volume, bass, treble] = await Promise.all([
      raceWithTimeout(controller.getVolume(), "getVolume"),
      raceWithTimeout(controller.getBass(), "getBass"),
      raceWithTimeout(controller.getTreble(), "getTreble"),
    ]);

    return {
      status: "SUCCESS",
      updatedSonosSpeakerState: {
        audioEqualizer: { volume, bass, treble },
      },
    };
  } catch (e) {
    console.warn("encoderAudioEqualizerTouchTap error:", e);
    return { status: "ERROR" };
  }
}

/**
 * Dial push (sonos-6sp): runs the same logic as the matching key so behaviour and the optimistic
 * projection stay identical. "NONE" (the default) keeps the old no-op.
 */
async function encoderAudioEqualizerDialDown(args) {
  const pushAction = args.inActionSettings?.encoderPushAction ?? "NONE";
  if (pushAction === "TOGGLE_MUTE") return toggleMuteKeyDown(args);
  if (pushAction === "TOGGLE_PLAY_PAUSE") return togglePlayPauseKeyDown(args);
  if (pushAction === "NEXT_TRACK") return playNextTrackKeyDown(args);
  return { status: "SUCCESS" };
}

function encoderAudioEqualizerState({ inActionSettings, inSonosSpeakerState }) {
  const target = inActionSettings.encoderAudioEqualizerTarget || "VOLUME";
  const band = target.toLowerCase();
  const value = inSonosSpeakerState?.audioEqualizer?.[band] ?? 0;
  const indicator = target === "VOLUME" ? value : value + 10;

  return {
    feedbackLayout: EQ_LAYOUTS[target],
    feedback: {
      // Mute does not change the volume level, so say so on the strip (dial push can toggle it).
      title: target === "VOLUME" && inSonosSpeakerState?.muted === true ? "Muted" : titleCase(target),
      value,
      indicator,
    },
  };
}

// Action 12: Encoder Play Mode (carousel dial, sonos-gen.3)
export const PLAY_MODE_DIAL_SETTLE_MS = 600;

function allowedPlayModes(inActionSettings) {
  return inActionSettings?.selectedPlayModes?.length > 0 ? inActionSettings.selectedPlayModes : PLAY_MODES;
}

/**
 * The modes the dial scrolls through and the one it currently rests on. A current mode outside the
 * dial's subset (set from the Sonos app) is shown as an extra first card, so one step right lands
 * on the first allowed mode and one step left on the last.
 */
export function playModeCards(inActionSettings, inSonosSpeakerState) {
  const current = inSonosSpeakerState?.playMode || "NORMAL";
  const allowed = allowedPlayModes(inActionSettings);
  const modes = allowed.includes(current) ? [...allowed] : [current, ...allowed];
  return { modes, index: modes.indexOf(current), current };
}

/** Turning stopped: apply the mode under the centre card (net ticks of the burst). */
async function encoderPlayModeDialRotate({ inActionSettings, inSonosSpeakerState, inRotation }) {
  const steps = Math.trunc(Number(inRotation) || 0);
  const { modes, index, current } = playModeCards(inActionSettings, inSonosSpeakerState);
  const next = modes[wrapIndex(index + steps, modes.length)];
  // Net zero (a burst that cancels out, or a full lap): nothing to send.
  if (steps === 0 || next === current) return { status: "SUCCESS" };
  try {
    const controller = makeController(inActionSettings.hostAddress, inActionSettings.uuid);
    await raceWithTimeout(controller.setPlayMode(next), "setPlayMode");
    return { status: "SUCCESS", updatedSonosSpeakerState: { playMode: next } };
  } catch (e) {
    console.warn("encoderPlayModeDialRotate error:", e);
    return { status: "ERROR" };
  }
}

/** Push and tap: next mode, like the Toggle Play Mode key, with a slide to the new card. */
async function encoderPlayModeNext(args) {
  const result = await togglePlayModeKeyDown(args);
  if (result?.status === "SUCCESS") slideNext(args.inContext);
  return result;
}

function encoderPlayModeState({ inContext, inActionSettings, inSonosSpeakerState }) {
  const { modes, index } = playModeCards(inActionSettings, inSonosSpeakerState);
  const cards = modes.map((mode) => ({
    caption: PLAY_MODE_DISPLAY[mode]?.label ?? titleCase(mode),
    image: PLAY_MODE_DISPLAY[mode]?.image,
  }));
  return {
    feedbackLayout: CAROUSEL_LAYOUT,
    feedback: carouselFeedback(inContext, { cards, index: index + pendingTicks(inContext) }),
  };
}

// Action 13: Encoder Queue Track (carousel dial, sonos-gen.2)
// Longer than the mode dial: slow browsing through a queue must not start tracks on the way.
export const QUEUE_DIAL_SETTLE_MS = 1000;
const QUEUE_ICON = "images/keys/input_sonos_queue.png";

/** What the queue dial knows about the speaker's queue from the last poll. */
export function queueView(inSonosSpeakerState) {
  const state = inSonosSpeakerState ?? {};
  const known = state.mediaURI !== undefined;
  const onQueue = String(state.mediaURI ?? "").startsWith("x-rincon-queue:");
  const total = onQueue ? Number(state.queueSignature?.total) || 0 : 0;
  const base = wrapIndex((Number(state.trackNumber) || 1) - 1, total);
  return { known, onQueue, total, base, signature: state.queueSignature ?? null };
}

async function playQueueTrack({ inActionSettings, inSonosSpeakerState }, target, label) {
  try {
    const controller = makeController(inActionSettings.hostAddress, inActionSettings.uuid);
    await raceWithTimeout(controller.seek("TRACK_NR", String(target + 1)), "seek");
    await raceWithTimeout(controller.play(), "play");
    const { signature } = queueView(inSonosSpeakerState);
    const item = queueItems(inActionSettings.uuid, signature, () => controller)[target];
    const projection = { trackNumber: target + 1, playbackState: "PLAYING" };
    if (item) {
      projection.playing = {
        title: item.title,
        artist: item.artist,
        album: item.album,
        albumArtURI: item.albumArtURI,
      };
    }
    return { status: "SUCCESS", updatedSonosSpeakerState: projection };
  } catch (e) {
    console.warn(`${label} error:`, e);
    return { status: "ERROR" };
  }
}

/** Turning stopped: play the track under the centre card (net ticks of the burst). */
async function encoderQueueTrackDialRotate(args) {
  const steps = Math.trunc(Number(args.inRotation) || 0);
  const { onQueue, total, base } = queueView(args.inSonosSpeakerState);
  if (!onQueue || total === 0 || steps === 0) return { status: "SUCCESS" };
  const target = wrapIndex(base + steps, total);
  if (target === base) return { status: "SUCCESS" }; // full lap(s)
  return playQueueTrack(args, target, "encoderQueueTrackDialRotate");
}

/** Push and tap: play the next track now (wrapping from the last to the first). */
async function encoderQueueTrackNext(args) {
  const { onQueue, total, base } = queueView(args.inSonosSpeakerState);
  if (!onQueue || total === 0) return { status: "SUCCESS" };
  const result = await playQueueTrack(args, wrapIndex(base + 1, total), "encoderQueueTrackNext");
  if (result.status === "SUCCESS" && total > 1) slideNext(args.inContext);
  return result;
}

function encoderQueueTrackState({ inContext, inActionSettings, inSonosSpeakerState }) {
  const { known, onQueue, total, base, signature } = queueView(inSonosSpeakerState);
  let feedback;
  if (!known) {
    feedback = messageFeedback(inContext, { caption: "Loading queue\u2026", image: QUEUE_ICON });
  } else if (!onQueue) {
    feedback = messageFeedback(inContext, { caption: "Not playing from queue", image: QUEUE_ICON });
  } else if (total === 0) {
    feedback = messageFeedback(inContext, { caption: "Queue is empty", image: QUEUE_ICON });
  } else {
    const items = queueItems(inActionSettings.uuid, signature, () =>
      makeController(inActionSettings.hostAddress, inActionSettings.uuid),
    );
    const index = wrapIndex(base + pendingTicks(inContext), total);
    // Only the cards that can be on the strip are filled in (long queues).
    const cards = new Array(total);
    for (let rel = -2; rel <= 2; rel++) {
      const i = wrapIndex(index + rel, total);
      const item = items[i];
      cards[i] = {
        caption: item?.title || `Track ${i + 1}`,
        artist: item?.artist ?? "",
        image: item?.albumArtURI ? albumArtImage(item.albumArtURI) || undefined : undefined,
      };
    }
    const artist = cards[index].artist;
    feedback = carouselFeedback(inContext, {
      cards,
      index,
      detail: `${artist ? `${artist} \u00b7 ` : ""}${index + 1} / ${total}`,
    });
  }
  return { feedbackLayout: CAROUSEL_LAYOUT, feedback };
}

// Register all actions
export function registerSonosActions() {
  // Action 1: currently-playing
  actionFunctionMap["currently-playing"].keyDown = [currentlyPlayingKeyDown];
  actionFunctionMap["currently-playing"].state.keypad = currentlyPlayingState;

  // Action 2: toggle-mute-unmute
  actionFunctionMap["toggle-mute-unmute"].keyDown = [toggleMuteKeyDown];
  actionFunctionMap["toggle-mute-unmute"].state.keypad = toggleMuteState;

  // Action 3: toggle-play-pause
  actionFunctionMap["toggle-play-pause"].keyDown = [togglePlayPauseKeyDown];
  actionFunctionMap["toggle-play-pause"].state.keypad = togglePlayPauseState;

  // Action 4: toggle-play-mode
  actionFunctionMap["toggle-play-mode"].keyDown = [togglePlayModeKeyDown];
  actionFunctionMap["toggle-play-mode"].state.keypad = togglePlayModeState;

  // Action 5: toggle-input-source
  actionFunctionMap["toggle-input-source"].keyDown = [toggleInputSourceKeyDown];
  actionFunctionMap["toggle-input-source"].state.keypad = toggleInputSourceState;

  // Action 6: play-next-track
  actionFunctionMap["play-next-track"].keyDown = [playNextTrackKeyDown];
  actionFunctionMap["play-next-track"].state.keypad = playNextTrackState;

  // Action 7: play-previous-track
  actionFunctionMap["play-previous-track"].keyDown = [playPreviousTrackKeyDown];
  actionFunctionMap["play-previous-track"].state.keypad = playPreviousTrackState;

  // Action 8: volume-up
  actionFunctionMap["volume-up"].keyDown = [volumeUpKeyDown];
  actionFunctionMap["volume-up"].state.keypad = volumeUpState;

  // Action 9: volume-down
  actionFunctionMap["volume-down"].keyDown = [volumeDownKeyDown];
  actionFunctionMap["volume-down"].state.keypad = volumeDownState;

  // Action 10: play-sonos-favorite
  actionFunctionMap["play-sonos-favorite"].keyDown = [playSonosFavoriteKeyDown];
  actionFunctionMap["play-sonos-favorite"].state.keypad = playSonosFavoriteState;

  // Action 11: encoder-audio-equalizer
  actionFunctionMap["encoder-audio-equalizer"].dialRotate = [encoderAudioEqualizerDialRotate];
  actionFunctionMap["encoder-audio-equalizer"].touchTap = [encoderAudioEqualizerTouchTap];
  actionFunctionMap["encoder-audio-equalizer"].dialDown = [encoderAudioEqualizerDialDown];
  actionFunctionMap["encoder-audio-equalizer"].state.encoder = encoderAudioEqualizerState;

  // Action 12: encoder-play-mode (carousel)
  const playModeDial = actionFunctionMap["encoder-play-mode"];
  playModeDial.carousel = true;
  playModeDial.dialSettleMs = PLAY_MODE_DIAL_SETTLE_MS;
  playModeDial.dialRotate = [encoderPlayModeDialRotate];
  playModeDial.dialDown = [encoderPlayModeNext];
  playModeDial.touchTap = [encoderPlayModeNext];
  playModeDial.state.encoder = encoderPlayModeState;

  // Action 13: encoder-queue-track (carousel)
  const queueDial = actionFunctionMap["encoder-queue-track"];
  queueDial.carousel = true;
  queueDial.dialSettleMs = QUEUE_DIAL_SETTLE_MS;
  queueDial.dialRotate = [encoderQueueTrackDialRotate];
  queueDial.dialDown = [encoderQueueTrackNext];
  queueDial.touchTap = [encoderQueueTrackNext];
  queueDial.state.encoder = encoderQueueTrackState;
}

// Register on import (idempotent)
registerSonosActions();
