// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  trackKey,
  canFavorite,
  refreshPlaylist,
  isInPlaylist,
  positionsOf,
  recordPlaylistChange,
  _resetFavoritesPlaylist,
  PLAYLIST_TITLE,
  SEARCH_RETRY_MS,
  MAX_TRACKS,
} from "@/modules/plugin/favoritesPlaylist.js";
import { buildActionSettingsPayload } from "@/modules/pi/actionSettingsSchema.js";
import { speakerNeedsFavoritesPlaylist } from "@/modules/plugin/pollingSupervisor.js";
import { addContext } from "@/modules/plugin/SonosSpeakers.js";
import { setActionSettings } from "@/modules/plugin/actionSettings.js";

const SONG = "x-sonos-spotify:spotify%3atrack%3a6WvF2AJU3J9PR9OHSqqcuk?sid=12&flags=8232&sn=7";
const SAME_SONG_OTHER_PLAYLIST = "x-sonos-spotify:spotify%3atrack%3a6WvF2AJU3J9PR9OHSqqcuk?sid=12&flags=8224&sn=3";
const OTHER = "x-sonos-spotify:spotify%3atrack%3a6t3GC2nW76Lqx3kAwZixUi?sid=12&flags=8232&sn=7";

function fakeSpeaker({ found = true, uris = [SONG], updateId = "4" } = {}) {
  const state = { uris, updateId };
  return {
    state,
    findPlaylist: vi.fn(async (title) => (found && title === PLAYLIST_TITLE ? { id: "SQ:4", title } : null)),
    getPlaylistSignature: vi.fn(async () => ({ updateId: state.updateId, total: state.uris.length })),
    getPlaylistTracks: vi.fn(async (id, { start, count }) => ({
      uris: state.uris.slice(start, start + count),
      total: state.uris.length,
      updateId: state.updateId,
    })),
  };
}

beforeEach(() => _resetFavoritesPlaylist());

describe("trackKey: matching a song", () => {
  it("same Spotify track from another playlist matches (flags/sn ignored)", () => {
    expect(trackKey(SONG)).toBe("spotify:track:6WvF2AJU3J9PR9OHSqqcuk");
    expect(trackKey(SAME_SONG_OTHER_PLAYLIST)).toBe(trackKey(SONG));
    expect(trackKey(SONG.replace(/&/g, "&amp;"))).toBe(trackKey(SONG));
    expect(trackKey(OTHER)).not.toBe(trackKey(SONG));
  });
  it("other sources keep their URI without query", () => {
    expect(trackKey("x-file-cifs://nas/music/a.mp3?x=1")).toBe("x-file-cifs://nas/music/a.mp3");
    expect(trackKey("")).toBe("");
  });
  it("only Spotify tracks can be favorited for now", () => {
    expect(canFavorite(SONG)).toBe(true);
    expect(canFavorite("x-sonosapi-stream:s1?sid=254")).toBe(false);
    expect(canFavorite("x-rincon-stream:RINCON_X")).toBe(false);
    expect(canFavorite("")).toBe(false);
  });
});

describe("refreshPlaylist", () => {
  it("finds the playlist and loads its songs", async () => {
    const sp = fakeSpeaker({ uris: [OTHER, SONG] });
    await refreshPlaylist("U", sp);
    expect(isInPlaylist("U", SAME_SONG_OTHER_PLAYLIST)).toBe(true);
    expect(positionsOf("U", SONG)).toEqual([1]);
  });

  it("re-reads songs only when the change counter or length changes", async () => {
    const sp = fakeSpeaker();
    await refreshPlaylist("U", sp);
    await refreshPlaylist("U", sp);
    expect(sp.getPlaylistTracks).toHaveBeenCalledTimes(1);
    expect(sp.getPlaylistSignature).toHaveBeenCalledTimes(2);
    // Edited in the Sonos app: counter moves.
    sp.state.uris = [OTHER];
    sp.state.updateId = "5";
    await refreshPlaylist("U", sp);
    expect(sp.getPlaylistTracks).toHaveBeenCalledTimes(2);
    expect(isInPlaylist("U", SONG)).toBe(false);
  });

  it("no playlist: not a favorite, and looks again only after a while", async () => {
    const sp = fakeSpeaker({ found: false });
    await refreshPlaylist("U", sp, { now: 1000 });
    await refreshPlaylist("U", sp, { now: 2000 });
    expect(sp.findPlaylist).toHaveBeenCalledTimes(1);
    expect(isInPlaylist("U", SONG)).toBe(false);
    await refreshPlaylist("U", sp, { now: 1000 + SEARCH_RETRY_MS + 1 });
    expect(sp.findPlaylist).toHaveBeenCalledTimes(2);
  });

  it("playlist deleted in the app: forgets it", async () => {
    const sp = fakeSpeaker();
    await refreshPlaylist("U", sp);
    sp.getPlaylistSignature.mockRejectedValueOnce(new Error("701"));
    await refreshPlaylist("U", sp);
    expect(isInPlaylist("U", SONG)).toBe(false);
  });

  it("force re-reads even when nothing seems changed", async () => {
    const sp = fakeSpeaker();
    await refreshPlaylist("U", sp);
    await refreshPlaylist("U", sp, { force: true });
    expect(sp.getPlaylistTracks).toHaveBeenCalledTimes(2);
  });

  it("reads long playlists in chunks of 100, up to the limit", async () => {
    const uris = Array.from({ length: 1234 }, (_, i) => `x-sonos-spotify:spotify%3atrack%3aT${i}?sid=12`);
    const sp = fakeSpeaker({ uris });
    await refreshPlaylist("U", sp);
    expect(sp.getPlaylistTracks).toHaveBeenCalledTimes(MAX_TRACKS / 100);
    expect(isInPlaylist("U", uris[999])).toBe(true);
    expect(isInPlaylist("U", uris[1000])).toBe(false);
  });

  it("all copies are found (duplicates added in the Sonos app)", async () => {
    await refreshPlaylist("U", fakeSpeaker({ uris: [SONG, OTHER, SAME_SONG_OTHER_PLAYLIST] }));
    expect(positionsOf("U", SONG)).toEqual([0, 2]);
  });

  it("recordPlaylistChange updates membership right away", () => {
    recordPlaylistChange("U", { id: "SQ:4", updateId: "9", total: 1, keys: [trackKey(SONG)] });
    expect(isInPlaylist("U", SONG)).toBe(true);
  });
});

describe("heart badge on Currently Playing / Play-Pause", () => {
  it("PI payload: heart on by default for the two keys, absent elsewhere", () => {
    const build = (action, overrides = {}) =>
      buildActionSettingsPayload({ action: `com.r-teller.sonoscontroller.${action}`, states: [], overrides })
        .displayFavoriteBadge;
    expect(build("currently-playing")).toBe(true);
    expect(build("toggle-play-pause", { displayFavoriteBadge: false })).toBe(false);
    expect(build("volume-up")).toBeNull();
  });

  it("the poll reads the playlist only for speakers that show a heart", () => {
    const UUID = "RINCON_BADGE";
    setActionSettings("b1", { action: "com.r-teller.sonoscontroller.currently-playing", uuid: UUID, displayAlbumArt: true });
    addContext({ UUID, context: "b1", hostAddress: "h" });
    expect(speakerNeedsFavoritesPlaylist(UUID)).toBe(true);
    setActionSettings("b1", {
      action: "com.r-teller.sonoscontroller.currently-playing",
      uuid: UUID,
      displayAlbumArt: true,
      displayFavoriteBadge: false,
    });
    expect(speakerNeedsFavoritesPlaylist(UUID)).toBe(false);
    setActionSettings("b1", { action: "com.r-teller.sonoscontroller.toggle-favorite-track", uuid: UUID });
    expect(speakerNeedsFavoritesPlaylist(UUID)).toBe(true);
  });
});
