import { actionSettings } from "./actionSettings.js";
import { getAllSpeakers } from "./SonosSpeakers.js";
import { MARQUEE_WIDTH, onAlbumArtCached } from "./marquee.js";
import { isFavoriteSettings, favoriteWantsMarquee } from "./favoriteKeys.js";

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

function renderContexts(refreshStateAndTitle, filter) {
  const speakers = getAllSpeakers();
  for (const [context, settings] of Object.entries(actionSettings)) {
    const speaker = settings?.uuid ? speakers[settings.uuid] : null;
    if (!speaker) continue;
    if (filter && !filter(settings, speaker.state)) continue;
    try {
      refreshStateAndTitle({ inContext: context, inSonosSpeakerState: speaker.state });
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
  const id = setInterval(() => renderContexts(refreshStateAndTitle, wantsMarquee), intervalMs);
  const unsubscribe = onAlbumArtCached(() => renderContexts(refreshStateAndTitle));
  return () => {
    clearInterval(id);
    unsubscribe();
  };
}
