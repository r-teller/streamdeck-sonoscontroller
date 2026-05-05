/**
 * Action handler registrations for the 11 Sonos actions.
 *
 * On import, this module mutates `actionFunctionMap` (etr.4 registry) so
 * every action's keyDown / dialRotate / state slots are populated. The
 * dispatcher (etr.4) reads through the map at dispatch time, so late
 * registration just works.
 *
 * Each action:
 * - keyDown / dialRotate / dialDown / touchTap → SOAP call(s) returning
 *   `{status: 'SUCCESS', updatedSonosSpeakerState}` or `{status: 'ERROR'}`.
 *   Errors flip the speaker to DISCONNECTED via the dispatcher.
 * - state.{keypad, encoder} → render-intent object consumed by etr.7's
 *   render dedupe (`stateIndex`, `title`, `imageDataURL`, `feedback`,
 *   `feedbackLayout`).
 *
 * See prd-what.md §5 (action catalog) and backend.md "Per-action SOAP
 * commands" for the SOAP routing rules.
 */

import { actionFunctionMap } from "@/modules/plugin/actionDispatcher.js";
import {
  makeController,
  raceWithTimeout,
  resolveVolumeIncrement,
  PLAY_MODES,
  INPUT_SOURCES,
} from "./helpers.js";
import { buildMarqueeRenderIntent } from "@/modules/plugin/marquee.js";
import { globalSettings } from "@/modules/plugin/globalSettings.js";

// ── Currently Playing — read-only, marquee-friendly ────────────────────────
//
// keyDown forces a state refresh outside the polling cadence (prd-what §5.1).

actionFunctionMap["currently-playing"].keyDown.push(async ({ inActionSettings }) => {
  const c = makeController(inActionSettings.hostAddress);
  const [transport, position, mute, volume, bass, treble] = await Promise.all([
    raceWithTimeout(c.getTransportInfo(), "get transport info"),
    raceWithTimeout(c.getPositionInfo(), "get position info"),
    raceWithTimeout(c.getMute(), "get mute"),
    raceWithTimeout(c.getVolume(), "get volume"),
    raceWithTimeout(c.getBass(), "get bass"),
    raceWithTimeout(c.getTreble(), "get treble"),
  ]);
  return {
    status: "SUCCESS",
    updatedSonosSpeakerState: {
      playbackState: transport.playbackState,
      muted: mute,
      audioEqualizer: { volume, bass, treble },
      currentURI: position.trackURI,
      playing: {
        title: position.title,
        artist: position.artist,
        album: position.album,
        albumArtURI: position.albumArtURI,
      },
    },
  };
});

actionFunctionMap["currently-playing"].state.keypad = (inActionSettings, inSonosSpeakerState) => {
  const marquee = buildMarqueeRenderIntent({ inActionSettings, inSonosSpeakerState });
  return {
    stateIndex: 0,
    imageDataURL: marquee.imageDataURL,
    title: marquee.title,
    titleSource: marquee.titleSource,
  };
};

// ── Toggle Mute ───────────────────────────────────────────────────────────

actionFunctionMap["toggle-mute-unmute"].keyDown.push(async ({ inActionSettings, inSonosSpeakerState }) => {
  const desired = !(inSonosSpeakerState?.muted === true);
  const c = makeController(inActionSettings.hostAddress);
  await raceWithTimeout(c.setMute(desired), "toggle mute");
  return {
    status: "SUCCESS",
    updatedSonosSpeakerState: { muted: desired },
  };
});

actionFunctionMap["toggle-mute-unmute"].state.keypad = (inActionSettings, inSonosSpeakerState) => {
  const muted = inSonosSpeakerState?.muted === true;
  return {
    stateIndex: muted ? 1 : 0,
    title: inActionSettings?.displayStateBasedTitle ? (muted ? "Muted" : "Unmuted") : null,
  };
};

// ── Toggle Play/Pause ─────────────────────────────────────────────────────

actionFunctionMap["toggle-play-pause"].keyDown.push(async ({ inActionSettings, inSonosSpeakerState }) => {
  const c = makeController(inActionSettings.hostAddress);
  const isPlaying = inSonosSpeakerState?.playbackState === "PLAYING";
  if (isPlaying) {
    await raceWithTimeout(c.pause(), "pause");
    return {
      status: "SUCCESS",
      updatedSonosSpeakerState: { playbackState: "PAUSED_PLAYBACK" },
    };
  }
  await raceWithTimeout(c.play(), "play");
  return {
    status: "SUCCESS",
    updatedSonosSpeakerState: { playbackState: "PLAYING" },
  };
});

actionFunctionMap["toggle-play-pause"].state.keypad = (inActionSettings, inSonosSpeakerState) => {
  const ps = inSonosSpeakerState?.playbackState;
  // Manifest order: 0=Paused, 1=Playing, 2=Stopped.
  let stateIndex = 0;
  let label = "Paused";
  if (ps === "PLAYING") {
    stateIndex = 1;
    label = "Playing";
  } else if (ps === "STOPPED") {
    stateIndex = 2;
    label = "Stopped";
  }
  const marquee = buildMarqueeRenderIntent({ inActionSettings, inSonosSpeakerState });
  return {
    stateIndex,
    title: inActionSettings?.displayStateBasedTitle ? label : marquee.title,
    titleSource: marquee.titleSource,
    imageDataURL: marquee.imageDataURL,
  };
};

// ── Toggle Play Mode (cycle through user-selected subset) ─────────────────

actionFunctionMap["toggle-play-mode"].keyDown.push(async ({ inActionSettings, inSonosSpeakerState }) => {
  const allowed = (inActionSettings?.selectedPlayModes && inActionSettings.selectedPlayModes.length > 0)
    ? inActionSettings.selectedPlayModes
    : PLAY_MODES.slice();
  const current = inSonosSpeakerState?.playMode || "NORMAL";
  const currentIdx = allowed.indexOf(current);
  // Fall back to first selected if current is not in the allow-list.
  const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % allowed.length;
  const nextMode = allowed[nextIdx];
  const c = makeController(inActionSettings.hostAddress);
  await raceWithTimeout(c.setPlayMode(nextMode), "set play mode");
  return {
    status: "SUCCESS",
    updatedSonosSpeakerState: { playMode: nextMode },
  };
});

actionFunctionMap["toggle-play-mode"].state.keypad = (inActionSettings, inSonosSpeakerState) => {
  const idx = PLAY_MODES.indexOf(inSonosSpeakerState?.playMode || "NORMAL");
  return {
    stateIndex: idx === -1 ? 0 : idx,
    title: inActionSettings?.displayStateBasedTitle
      ? (inSonosSpeakerState?.playMode || "NORMAL")
          .replaceAll("_", " ")
          .toLowerCase()
          .replace(/\b\w/g, (m) => m.toUpperCase())
      : null,
  };
};

// ── Toggle Input Source ───────────────────────────────────────────────────
//
// URI prefix detection determines current source; cycling builds the next
// URI via setLocalTransport(prefix, suffix) per backend.md "Per-action SOAP
// commands" and §5.5 of prd-what.md.

function detectInputSourceFromURI(uri) {
  const u = String(uri || "");
  if (u.startsWith("x-sonos-htastream") && u.endsWith(":spdif")) return "TV_INPUT";
  if (u.startsWith("x-rincon-stream")) return "LINE_IN";
  return "SONOS_QUEUE";
}

const INPUT_SOURCE_PREFIX = {
  SONOS_QUEUE: ["x-rincon-queue:", "#0"],
  TV_INPUT: ["x-sonos-htastream:", ":spdif"],
  LINE_IN: ["x-rincon-stream:", ""],
};

actionFunctionMap["toggle-input-source"].keyDown.push(async ({ inActionSettings, inSonosSpeakerState }) => {
  const allowed = (inActionSettings?.selectedInputSources && inActionSettings.selectedInputSources.length > 0)
    ? inActionSettings.selectedInputSources
    : INPUT_SOURCES.slice();
  const current = detectInputSourceFromURI(inSonosSpeakerState?.currentURI);
  const currentIdx = allowed.indexOf(current);
  const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % allowed.length;
  const nextSource = allowed[nextIdx];
  const [prefix, suffix] = INPUT_SOURCE_PREFIX[nextSource];
  const c = makeController(inActionSettings.hostAddress);
  await raceWithTimeout(c.setLocalTransport(prefix, suffix), "set input source");
  await raceWithTimeout(c.play(), "play after input change");
  // Build next URI for optimistic projection. Coordinator UUID is the
  // bound speaker for the simple case — the full coordinator-routing
  // happens server-side in setLocalTransport.
  const projectedURI = `${prefix}${inActionSettings.uuid}${suffix}`;
  return {
    status: "SUCCESS",
    updatedSonosSpeakerState: {
      currentURI: projectedURI,
      playbackState: "PLAYING",
    },
  };
});

actionFunctionMap["toggle-input-source"].state.keypad = (inActionSettings, inSonosSpeakerState) => {
  const source = detectInputSourceFromURI(inSonosSpeakerState?.currentURI);
  const stateIndex = { SONOS_QUEUE: 0, TV_INPUT: 1, LINE_IN: 2 }[source] ?? 0;
  return {
    stateIndex,
    title: inActionSettings?.displayStateBasedTitle
      ? source.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase())
      : null,
  };
};

// ── Play Next Track / Previous Track ──────────────────────────────────────

actionFunctionMap["play-next-track"].keyDown.push(async ({ inActionSettings }) => {
  const c = makeController(inActionSettings.hostAddress);
  await raceWithTimeout(c.next(), "next track");
  // No state projection — the next polling tick will re-fetch playing.
  return { status: "SUCCESS", updatedSonosSpeakerState: {} };
});

actionFunctionMap["play-next-track"].state.keypad = (inActionSettings) => ({
  stateIndex: 0,
  title: inActionSettings?.displayStateBasedTitle ? "Next" : null,
});

actionFunctionMap["play-previous-track"].keyDown.push(async ({ inActionSettings }) => {
  const c = makeController(inActionSettings.hostAddress);
  await raceWithTimeout(c.previous(), "previous track");
  return { status: "SUCCESS", updatedSonosSpeakerState: {} };
});

actionFunctionMap["play-previous-track"].state.keypad = (inActionSettings) => ({
  stateIndex: 0,
  title: inActionSettings?.displayStateBasedTitle ? "Previous" : null,
});

// ── Volume Up / Volume Down ───────────────────────────────────────────────

actionFunctionMap["volume-up"].keyDown.push(async ({ inActionSettings, inSonosSpeakerState }) => {
  const increment = resolveVolumeIncrement(inActionSettings);
  const current = inSonosSpeakerState?.audioEqualizer?.volume ?? 0;
  const next = Math.min(100, current + increment);
  const c = makeController(inActionSettings.hostAddress);
  await raceWithTimeout(c.setVolume(next), "volume up");
  return {
    status: "SUCCESS",
    updatedSonosSpeakerState: {
      audioEqualizer: { volume: next },
    },
  };
});

actionFunctionMap["volume-up"].state.keypad = (inActionSettings, inSonosSpeakerState) => ({
  stateIndex: 0,
  title: inActionSettings?.displayStateBasedTitle
    ? `Vol ${inSonosSpeakerState?.audioEqualizer?.volume ?? "—"}`
    : null,
});

actionFunctionMap["volume-down"].keyDown.push(async ({ inActionSettings, inSonosSpeakerState }) => {
  const increment = resolveVolumeIncrement(inActionSettings);
  const current = inSonosSpeakerState?.audioEqualizer?.volume ?? 0;
  const next = Math.max(0, current - increment);
  const c = makeController(inActionSettings.hostAddress);
  await raceWithTimeout(c.setVolume(next), "volume down");
  return {
    status: "SUCCESS",
    updatedSonosSpeakerState: {
      audioEqualizer: { volume: next },
    },
  };
});

actionFunctionMap["volume-down"].state.keypad = (inActionSettings, inSonosSpeakerState) => ({
  stateIndex: 0,
  title: inActionSettings?.displayStateBasedTitle
    ? `Vol ${inSonosSpeakerState?.audioEqualizer?.volume ?? "—"}`
    : null,
});

// ── Play Sonos Favorite ───────────────────────────────────────────────────

actionFunctionMap["play-sonos-favorite"].keyDown.push(async ({ inActionSettings }) => {
  const fav = inActionSettings?.selectedSonosFavorite;
  if (!fav || !fav.uri) {
    return { status: "ERROR" };
  }
  const c = makeController(inActionSettings.hostAddress);
  // setServiceURI handles the full RemoveAllTracksFromQueue → AddURIToQueue →
  // SetAVTransportURI → Seek → Play cascade (and the radio-stream skip
  // path) per backend.md "Per-action SOAP commands".
  await raceWithTimeout(c.setServiceURI(fav), "play favorite");
  return {
    status: "SUCCESS",
    updatedSonosSpeakerState: {
      playbackState: "PLAYING",
      currentURI: fav.uri,
      playing: {
        title: fav.title,
        albumArtURI: fav.albumArtURI,
      },
    },
  };
});

actionFunctionMap["play-sonos-favorite"].state.keypad = (inActionSettings, inSonosSpeakerState) => {
  const marquee = buildMarqueeRenderIntent({ inActionSettings, inSonosSpeakerState });
  return {
    stateIndex: 0,
    imageDataURL: marquee.imageDataURL,
    title: marquee.title,
    titleSource: marquee.titleSource,
  };
};

// ── Audio Equalizer (Encoder, SD+ only) ──────────────────────────────────

const EQ_LAYOUTS = {
  VOLUME: "./layouts/encoder-bar-0-100.json",
  BASS: "./layouts/encoder-gbar-10-10.json",
  TREBLE: "./layouts/encoder-gbar-10-10.json",
};

function clampForTarget(target, value) {
  if (target === "VOLUME") return Math.min(100, Math.max(0, value));
  // Bass / Treble: [-10, +10]
  return Math.min(10, Math.max(-10, value));
}

actionFunctionMap["encoder-audio-equalizer"].dialRotate.push(
  async ({ inActionSettings, inSonosSpeakerState, inRotation }) => {
    const target = inActionSettings?.encoderAudioEqualizerTarget || "VOLUME";
    const eq = inSonosSpeakerState?.audioEqualizer || {};
    const current = target === "VOLUME" ? (eq.volume ?? 0) : target === "BASS" ? (eq.bass ?? 0) : (eq.treble ?? 0);
    const next = clampForTarget(target, current + (inRotation || 0));
    const c = makeController(inActionSettings.hostAddress);
    if (target === "VOLUME") {
      await raceWithTimeout(c.setVolume(next), "set volume");
    } else if (target === "BASS") {
      await raceWithTimeout(c.setBass(next), "set bass");
    } else {
      await raceWithTimeout(c.setTreble(next), "set treble");
    }
    return {
      status: "SUCCESS",
      updatedSonosSpeakerState: {
        audioEqualizer: { [target.toLowerCase()]: next },
      },
    };
  },
);

// touchTap = refresh state (re-fetch and re-render).
actionFunctionMap["encoder-audio-equalizer"].touchTap.push(async ({ inActionSettings }) => {
  const c = makeController(inActionSettings.hostAddress);
  const [volume, bass, treble] = await Promise.all([
    raceWithTimeout(c.getVolume(), "get volume"),
    raceWithTimeout(c.getBass(), "get bass"),
    raceWithTimeout(c.getTreble(), "get treble"),
  ]);
  return {
    status: "SUCCESS",
    updatedSonosSpeakerState: { audioEqualizer: { volume, bass, treble } },
  };
});

actionFunctionMap["encoder-audio-equalizer"].state.encoder = (inActionSettings, inSonosSpeakerState) => {
  const target = inActionSettings?.encoderAudioEqualizerTarget || "VOLUME";
  const eq = inSonosSpeakerState?.audioEqualizer || {};
  const value = target === "VOLUME" ? (eq.volume ?? 0) : target === "BASS" ? (eq.bass ?? 0) : (eq.treble ?? 0);
  const layout = EQ_LAYOUTS[target] || EQ_LAYOUTS.VOLUME;
  return {
    feedbackLayout: layout,
    feedback: {
      title: target.charAt(0) + target.slice(1).toLowerCase(),
      value,
      indicator: target === "VOLUME" ? value : value + 10, // [-10..10] → [0..20]
    },
  };
};

export { globalSettings };
