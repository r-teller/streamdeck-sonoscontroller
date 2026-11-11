// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

let controller;
vi.mock("@/modules/actions/helpers.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, makeController: vi.fn(() => controller), raceWithTimeout: (p) => p };
});

import { actionFunctionMap, _resetActionFunctionMap } from "@/modules/plugin/actionDispatcher.js";
import { registerSonosActions, FAVORITE_TRACK_STATES } from "@/modules/actions/sonosActions.js";
import {
  _resetFavoritesPlaylist,
  isInPlaylist,
  spotifyTrackMetadata,
  PLAYLIST_TITLE,
} from "@/modules/plugin/favoritesPlaylist.js";

const UUID = "RINCON_X";
const SONG = "x-sonos-spotify:spotify%3atrack%3a6WvF2AJU3J9PR9OHSqqcuk?sid=12&flags=8232&sn=7";
const SAME_SONG = "x-sonos-spotify:spotify%3atrack%3a6WvF2AJU3J9PR9OHSqqcuk?sid=12&flags=8224&sn=3";
const OTHER = "x-sonos-spotify:spotify%3atrack%3a6t3GC2nW76Lqx3kAwZixUi?sid=12&flags=8232&sn=7";
const key = () => actionFunctionMap["toggle-favorite-track"];
const playing = (uri = SONG, extra = {}) => ({
  currentURI: uri,
  playing: { title: "Heaven For The Sinner", artist: "Bonobo", album: "Fragments", albumArtURI: "http://h:1400/getaa?s=1&u=x" },
  ...extra,
});
const press = (state, settings = {}) =>
  key().keyDown[0]({
    inContext: "c",
    inActionSettings: { hostAddress: "h", uuid: UUID, ...settings },
    inSonosSpeakerState: state,
  });

/** A speaker with a Sonos playlist store, like the real one (stale UpdateID refused). */
function fakeSpeaker(playlist = null) {
  const store = playlist ? { id: "SQ:4", uris: [...playlist], updateId: 3 } : null;
  const s = {
    store: () => store ?? s.created,
    created: null,
    findPlaylist: vi.fn(async (title) => {
      const pl = s.store();
      return pl && title === PLAYLIST_TITLE ? { id: pl.id, title } : null;
    }),
    getPlaylistSignature: vi.fn(async () => ({ updateId: String(s.store().updateId), total: s.store().uris.length })),
    getPlaylistTracks: vi.fn(async (id, { start, count }) => ({ uris: s.store().uris.slice(start, start + count) })),
    createPlaylist: vi.fn(async () => {
      s.created = { id: "SQ:9", uris: [], updateId: 0 };
      return "SQ:9";
    }),
    addToPlaylist: vi.fn(async (id, updateId, uri) => {
      const pl = s.store();
      if (String(updateId) !== String(pl.updateId)) throw new Error("stale");
      pl.uris.push(uri);
      pl.updateId += 1;
      return { updateId: String(pl.updateId), total: pl.uris.length };
    }),
    removeFromPlaylist: vi.fn(async (id, updateId, indices) => {
      const pl = s.store();
      const drop = new Set(indices);
      pl.uris = pl.uris.filter((_, i) => !drop.has(i));
      pl.updateId += 1;
      return { updateId: String(pl.updateId), total: pl.uris.length };
    }),
  };
  return s;
}

beforeEach(() => {
  _resetActionFunctionMap();
  registerSonosActions();
  _resetFavoritesPlaylist();
});

describe("Favorite Song key: press", () => {
  it("adds the playing song with Spotify metadata, after re-reading the playlist", async () => {
    controller = fakeSpeaker([OTHER]);
    const r = await press(playing());
    expect(r).toEqual({ status: "SUCCESS", updatedSonosSpeakerState: { inFavorites: true } });
    expect(controller.getPlaylistTracks).toHaveBeenCalled();
    const [id, updateId, uri, metadata] = controller.addToPlaylist.mock.calls[0];
    expect([id, updateId, uri]).toEqual(["SQ:4", "3", SONG]);
    expect(metadata).toContain('<item id="10032020spotify%3atrack%3a6WvF2AJU3J9PR9OHSqqcuk"');
    expect(metadata).toContain("SA_RINCON3079_X_#Svc3079-0-Token");
    expect(metadata).toContain("<dc:title>Heaven For The Sinner</dc:title>");
    expect(metadata).toContain("<upnp:albumArtURI>/getaa?s=1&amp;u=x</upnp:albumArtURI>");
    expect(isInPlaylist(UUID, SONG)).toBe(true);
  });

  it("never adds a duplicate: the same song (any flags) is removed instead, every copy", async () => {
    controller = fakeSpeaker([SAME_SONG, OTHER, SONG]);
    const r = await press(playing(SONG, { inFavorites: false })); // stale state: the playlist decides
    expect(controller.addToPlaylist).not.toHaveBeenCalled();
    expect(controller.removeFromPlaylist).toHaveBeenCalledWith("SQ:4", "3", [0, 2]);
    expect(r.updatedSonosSpeakerState).toEqual({ inFavorites: false });
    expect(controller.store().uris).toEqual([OTHER]);
  });

  it("remove turned off: a favorite stays, nothing is sent", async () => {
    controller = fakeSpeaker([SONG]);
    const r = await press(playing(), { allowRemoveFavorite: false });
    expect(controller.removeFromPlaylist).not.toHaveBeenCalled();
    expect(controller.addToPlaylist).not.toHaveBeenCalled();
    expect(r.updatedSonosSpeakerState).toEqual({ inFavorites: true });
  });

  it("creates the playlist on first use", async () => {
    controller = fakeSpeaker(null);
    await press(playing());
    expect(controller.createPlaylist).toHaveBeenCalledWith(PLAYLIST_TITLE);
    expect(controller.addToPlaylist.mock.calls[0].slice(0, 3)).toEqual(["SQ:9", "0", SONG]);
  });

  it("a fast double press is add then remove, never two adds", async () => {
    controller = fakeSpeaker([]);
    await Promise.all([press(playing()), press(playing())]);
    expect(controller.addToPlaylist).toHaveBeenCalledTimes(1);
    expect(controller.removeFromPlaylist).toHaveBeenCalledTimes(1);
    expect(controller.store().uris).toEqual([]);
  });

  it("TV, line-in, radio and other services: nothing sent", async () => {
    controller = fakeSpeaker([]);
    for (const uri of ["x-sonos-htastream:RINCON_X:spdif", "x-rincon-stream:RINCON_X", "x-sonosapi-stream:s1?sid=254", ""]) {
      expect(await press(playing(uri))).toEqual({ status: "SUCCESS" });
    }
    expect(await press({})).toEqual({ status: "SUCCESS" }); // nothing playing yet
    expect(controller.findPlaylist).not.toHaveBeenCalled();
  });

  it("speaker error -> ERROR (alert)", async () => {
    controller = fakeSpeaker([]);
    controller.addToPlaylist.mockRejectedValueOnce(new Error("boom"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await press(playing())).toEqual({ status: "ERROR" });
  });
});

describe("Favorite Song key: face", () => {
  const face = (state) => key().state.keypad({ inActionSettings: {}, inSonosSpeakerState: state }).stateIndex;
  it("outline, filled, dimmed", () => {
    expect(face(playing(SONG, { inFavorites: false }))).toBe(FAVORITE_TRACK_STATES.NOT_FAVORITE);
    expect(face(playing(SONG, { inFavorites: true }))).toBe(FAVORITE_TRACK_STATES.FAVORITE);
    expect(face(playing("x-rincon-stream:RINCON_X"))).toBe(FAVORITE_TRACK_STATES.UNAVAILABLE);
    expect(face({})).toBe(FAVORITE_TRACK_STATES.UNAVAILABLE);
  });
});

describe("spotifyTrackMetadata", () => {
  it("null for non-Spotify or missing sid", () => {
    expect(spotifyTrackMetadata({ uri: "x-rincon-stream:RINCON_X" })).toBeNull();
    expect(spotifyTrackMetadata({ uri: "x-sonos-spotify:spotify%3atrack%3aABC" })).toBeNull();
  });
  it("escapes titles", () => {
    expect(spotifyTrackMetadata({ uri: SONG, title: "Rock & <Roll>" })).toContain(
      "<dc:title>Rock &amp; &lt;Roll&gt;</dc:title>",
    );
  });
});
