import { actionSettings } from "./actionSettings.js";
import { getAllSpeakers } from "./SonosSpeakers.js";
import { MARQUEE_WIDTH, onAlbumArtCached } from "./marquee.js";
import { isFavoriteSettings, favoriteWantsMarquee } from "./favoriteKeys.js";
import { trackTimeTicking } from "./trackTime.js";
import { onKeyImageReady } from "./keyImage.js";

/**
 * Whether a key currently needs frame-by-frame re-rendering for a scrolling title. Favorite keys
 * scroll only while active (sonos-gw5); Currently Playing / Play-Pause scroll their track/album.
 */
export function wantsMarquee(settings, state) {
  if (!settings || !state) return false;
  if (isFavoriteSettings(settings)) return favoriteWantsMarquee(settings, state);
  const title = String(state.playing?.title ?? "");
  const album = String(state.playing?.album ?? "");
  return (
    (settings.displayMarqueeTitle === true && title.length > MARQUEE_WIDTH) ||
    (settings.displayMarqueeAlbumTitle === true && album.length > MARQUEE_WIDTH)
  );
}

function renderContexts(refreshStateAndTitle, filter, advanceMarquee = false) {
  const speakers = getAllSpeakers();
  for (const [context, settings] of Object.entries(actionSettings)) {
    const speaker = settings?.uuid ? speakers[settings.uuid] : null;
    if (!speaker) continue;
    if (filter && !filter(settings, speaker.state)) continue;
    try {
      refreshStateAndTitle({ inContext: context, inSonosSpeakerState: speaker.state, advanceMarquee });
    } catch (e) {
      // one bad key must not stop the others
    }
  }
}

/**
 * Local render loop, independent of speaker polling (sonos-8lu):
 *  - every `intervalMs`, advance marquees on keys whose titles scroll, from cached speaker state;
 *  - when album art finishes downloading, redraw keys so they stop showing the default image (sonos-clg).
 * Returns a stop function.
 */
export function startRenderTicker({ refreshStateAndTitle, intervalMs = 500 }) {
  // Only these frames move scrolling text; art/poll/action redraws repeat the current frame (sonos-9at).
  const id = setInterval(() => {
    renderContexts(refreshStateAndTitle, wantsMarquee, true);
    // Track time counts down between polls (sonos-bg0.2); keys already redrawn above are skipped.
    // The image only changes once a second, and unchanged images are not resent.
    renderContexts(
      refreshStateAndTitle,
      (settings, state) => !wantsMarquee(settings, state) && trackTimeTicking(settings, state),
    );
  }, intervalMs);
  const unsubscribe = onAlbumArtCached(() => renderContexts(refreshStateAndTitle));
  const unsubscribeImages = onKeyImageReady(() => renderContexts(refreshStateAndTitle));
  return () => {
    clearInterval(id);
    unsubscribe();
    unsubscribeImages();
  };
}
