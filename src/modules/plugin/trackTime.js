/**
 * Track time on Currently Playing and Play/Pause keys (sonos-bg0.2): remaining time above a thin
 * progress bar, drawn into the key image. Sonos reports the position on each poll; between polls
 * the key counts the seconds itself while the speaker is playing.
 */

/** "0:04:45" / "4:45" -> 285. Returns null for "", "NOT_IMPLEMENTED" and other non-times. */
export function parseClock(text) {
  const parts = String(text ?? "")
    .trim()
    .split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.reduce((total, p) => total * 60 + Number(p), 0);
}

/** 142 -> "2:22", 3723 -> "1:02:03". */
export function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** The position snapshot a poll stores in speaker state (`state.position`). */
export function positionSnapshot(positionInfo, now = Date.now()) {
  const elapsed = parseClock(positionInfo?.relTime);
  if (elapsed === null) return null;
  const duration = parseClock(positionInfo?.trackDuration);
  return { elapsed, duration: duration && duration > 0 ? duration : null, at: now };
}

function isPlaying(state) {
  const s = state?.playbackState;
  return s === "PLAYING" || s === "TRANSITIONING";
}

/**
 * What the key shows now: `{ text, fraction }` where text is "-2:22" (remaining) for a track with a
 * length, or "12:04" (elapsed) for radio and streams, and fraction is 0..1 for the bar or null when
 * there is no length. Null when the speaker reported no position.
 */
export function trackTimeView(state, now = Date.now()) {
  const pos = state?.position;
  if (!pos || typeof pos.elapsed !== "number") return null;
  const ticking = isPlaying(state) ? Math.max(0, (now - (pos.at ?? now)) / 1000) : 0;
  if (pos.duration) {
    const elapsed = Math.min(pos.duration, pos.elapsed + ticking);
    return { text: `-${formatClock(pos.duration - elapsed)}`, fraction: elapsed / pos.duration };
  }
  return { text: formatClock(pos.elapsed + ticking), fraction: null };
}

/** Track time is on unless the key's setting turns it off (older keys have no setting yet). */
export function wantsTrackTime(settings) {
  return settings?.displayTrackTime !== false;
}

/** Keys whose time changes every second right now, so the render ticker redraws them. */
export function trackTimeTicking(settings, state) {
  return (
    wantsTrackTime(settings) &&
    settings?.displayAlbumArt === true &&
    isPlaying(state) &&
    typeof state?.position?.elapsed === "number"
  );
}
