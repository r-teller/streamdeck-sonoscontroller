// p12 - Favorite Song key (sonos-bg0.4): adds the playing Spotify song to the "Stream Deck
// Favorites" Sonos playlist or removes it; never adds a duplicate. Follows docs/adding-actions.md.
import { test, expect } from "@playwright/test";
import { mockStreamDeckHostSource, createMockHost, connect } from "./support/mockStreamDeckHost.js";
import { installMockSonos } from "./support/mockSonos.js";

const SPEAKER = { uuid: "RINCON_OFFICE01400", hostAddress: "192.168.1.42", zoneName: "Office" };
const ACTION = "com.r-teller.sonoscontroller.toggle-favorite-track";
const PLAYLIST = "Stream Deck Favorites";
// Playing song (fixture getpositioninfo-spotify-id.xml) and the same song with other flags/sn.
const SONG = "x-sonos-spotify:spotify%3atrack%3a6WvF2AJU3J9PR9OHSqqcuk?sid=12&flags=8232&sn=7";
const SAME_SONG = "x-sonos-spotify:spotify%3atrack%3a6WvF2AJU3J9PR9OHSqqcuk?sid=12&flags=8224&sn=3";
const OTHER_SONG = "x-sonos-spotify:spotify%3atrack%3a6t3GC2nW76Lqx3kAwZixUi?sid=12&flags=8232&sn=7";
const STATE = { NOT_FAVORITE: 0, FAVORITE: 1, UNAVAILABLE: 2 };

const GETTER_FIXTURES = {
  GetTransportInfo: "gettransportinfo-playing.xml",
  GetTransportSettings: "gettransportsettings-shuffle.xml",
  GetMute: "getmute-unmuted-response.xml",
  GetVolume: "soap-getvolume-response.xml",
  GetBass: "getbass-response.xml",
  GetTreble: "gettreble-response.xml",
  GetPositionInfo: "getpositioninfo-spotify-id.xml",
};

async function setup(page, { playlists = {}, fixtures = {} } = {}) {
  const mock = await installMockSonos(page, {
    topologyFixture: "zonegroupstate-single-group-single-member.xml",
    actionFixtures: { ...GETTER_FIXTURES, ...fixtures },
    playlists,
  });
  await page.addInitScript(mockStreamDeckHostSource);
  await page.goto("/plugin.html");
  const mockHost = createMockHost(page);
  await connect(page, { uuid: "plugin-uuid-p12", registerEvent: "registerPlugin", actionInfo: null });
  const pageErrors = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" && !text.includes("net::ERR") && !text.includes("Failed to load resource"))
      pageErrors.push(text);
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  const face = async (ctx) =>
    (await mockHost.outbound("setState"))
      .filter((f) => f.context === ctx)
      .map((f) => f.payload.state)
      .at(-1);
  const calls = (action) => mock.calls.filter((c) => c.action === action);
  const alerts = async (ctx) => (await mockHost.outbound("showAlert")).filter((f) => f.context === ctx);
  return { mock, mockHost, pageErrors, face, calls, alerts };
}

async function screenshotKey(page, mockHost, ctx, name) {
  const frames = (await mockHost.outbound()).filter((f) => f.context === ctx);
  await page.goto("/harness/key-preview.html");
  const stateImages = {
    [ctx]: ["images/keys/favorite_track_off", "images/keys/favorite_track_on", "images/keys/favorite_track_unavailable"],
  };
  await page.evaluate(([f, s]) => window.renderFrames(f, { stateImages: s }), [frames, stateImages]);
  await page.screenshot({ path: `tests/playwright/screenshots/p12-${name}.png`, fullPage: true });
}

test.describe("p12 - Favorite Song key", () => {
  test("p12-appear-not-favorite", async ({ page }) => {
    const { mockHost, pageErrors, face, calls } = await setup(page, { playlists: { [PLAYLIST]: [OTHER_SONG] } });
    const ctx = "ctx-fav";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER });
    await expect.poll(() => face(ctx), { timeout: 8000 }).toBe(STATE.NOT_FAVORITE);
    expect(calls("AddURIToSavedQueue")).toEqual([]);
    await screenshotKey(page, mockHost, ctx, "not-favorite");
    expect(pageErrors).toEqual([]);
  });

  test("p12-press-adds-with-spotify-metadata", async ({ page }) => {
    const { mock, mockHost, pageErrors, face, calls } = await setup(page, { playlists: { [PLAYLIST]: [OTHER_SONG] } });
    const ctx = "ctx-add";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER });
    await expect.poll(() => face(ctx), { timeout: 8000 }).toBe(STATE.NOT_FAVORITE);

    await mockHost.inject.keyDown(ctx);
    await expect.poll(() => calls("AddURIToSavedQueue").length, { timeout: 8000 }).toBe(1);
    const body = calls("AddURIToSavedQueue")[0].body;
    // Argument order matters to the speaker: InstanceID, UpdateID, ObjectID, EnqueuedURI, ...
    expect(body.indexOf("<UpdateID>")).toBeLessThan(body.indexOf("<ObjectID>"));
    expect(body).toContain("<ObjectID>SQ:1</ObjectID>");
    expect(body).toContain("10032020spotify%3atrack%3a6WvF2AJU3J9PR9OHSqqcuk");
    expect(body).toContain("SA_RINCON3079_X_#Svc3079-0-Token");
    expect(mock.playlistUris(PLAYLIST)).toEqual([OTHER_SONG, SONG]);
    await expect.poll(() => face(ctx)).toBe(STATE.FAVORITE);

    // Press again: removed.
    await mockHost.inject.keyDown(ctx);
    await expect.poll(() => calls("ReorderTracksInSavedQueue").length, { timeout: 8000 }).toBe(1);
    expect(calls("ReorderTracksInSavedQueue")[0].body).toContain("<TrackList>1</TrackList>");
    expect(mock.playlistUris(PLAYLIST)).toEqual([OTHER_SONG]);
    await expect.poll(() => face(ctx)).toBe(STATE.NOT_FAVORITE);
    expect(calls("AddURIToSavedQueue")).toHaveLength(1);
    expect(pageErrors).toEqual([]);
  });

  test("p12-no-duplicate-after-sonos-app-edit", async ({ page }) => {
    const { mock, mockHost, pageErrors, face, calls } = await setup(page, { playlists: { [PLAYLIST]: [OTHER_SONG] } });
    const ctx = "ctx-dup";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER });
    await expect.poll(() => face(ctx), { timeout: 8000 }).toBe(STATE.NOT_FAVORITE);
    // Someone adds the song (twice, from another playlist) in the Sonos app; press before the next poll.
    mock.editPlaylist(PLAYLIST, [SAME_SONG, OTHER_SONG, SAME_SONG]);
    await mockHost.inject.keyDown(ctx);
    await expect.poll(() => calls("ReorderTracksInSavedQueue").length, { timeout: 8000 }).toBe(1);
    expect(calls("AddURIToSavedQueue")).toEqual([]);
    expect(calls("ReorderTracksInSavedQueue")[0].body).toContain("<TrackList>0,2</TrackList>");
    expect(mock.playlistUris(PLAYLIST)).toEqual([OTHER_SONG]);
    expect(pageErrors).toEqual([]);
  });

  test("p12-remove-turned-off", async ({ page }) => {
    const { mockHost, pageErrors, face, calls } = await setup(page, { playlists: { [PLAYLIST]: [SONG] } });
    const ctx = "ctx-keep";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER, allowRemoveFavorite: false });
    await expect.poll(() => face(ctx), { timeout: 8000 }).toBe(STATE.FAVORITE);
    await screenshotKey(page, mockHost, ctx, "favorite");
    expect(calls("ReorderTracksInSavedQueue")).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("p12-remove-turned-off-press", async ({ page }) => {
    const { mock, mockHost, pageErrors, face, calls } = await setup(page, { playlists: { [PLAYLIST]: [SONG] } });
    const ctx = "ctx-keep2";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER, allowRemoveFavorite: false });
    await expect.poll(() => face(ctx), { timeout: 8000 }).toBe(STATE.FAVORITE);
    await mockHost.inject.keyDown(ctx);
    await page.waitForTimeout(1200);
    expect(calls("ReorderTracksInSavedQueue")).toEqual([]);
    expect(calls("AddURIToSavedQueue")).toEqual([]);
    expect(mock.playlistUris(PLAYLIST)).toEqual([SONG]);
    expect(await face(ctx)).toBe(STATE.FAVORITE);
    expect(pageErrors).toEqual([]);
  });

  test("p12-creates-playlist-on-first-press", async ({ page }) => {
    const { mock, mockHost, pageErrors, face, calls } = await setup(page);
    const ctx = "ctx-create";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER });
    await expect.poll(() => face(ctx), { timeout: 8000 }).toBe(STATE.NOT_FAVORITE);
    await mockHost.inject.keyDown(ctx);
    await expect.poll(() => mock.playlistUris(PLAYLIST), { timeout: 8000 }).toEqual([SONG]);
    expect(calls("CreateSavedQueue")).toHaveLength(1);
    expect(calls("CreateSavedQueue")[0].body).toContain(`<Title>${PLAYLIST}</Title>`);
    await expect.poll(() => face(ctx)).toBe(STATE.FAVORITE);
    expect(pageErrors).toEqual([]);
  });

  test("p12-tv-cannot-favorite", async ({ page }) => {
    const { mockHost, pageErrors, face, calls } = await setup(page, {
      playlists: { [PLAYLIST]: [] },
      fixtures: { GetPositionInfo: "getpositioninfo-tv.xml" },
    });
    const ctx = "ctx-tv";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER });
    await expect.poll(() => face(ctx), { timeout: 8000 }).toBe(STATE.UNAVAILABLE);
    await mockHost.inject.keyDown(ctx);
    await page.waitForTimeout(1200);
    expect(calls("AddURIToSavedQueue")).toEqual([]);
    expect(calls("CreateSavedQueue")).toEqual([]);
    await screenshotKey(page, mockHost, ctx, "unavailable");
    expect(pageErrors).toEqual([]);
  });

  test("p12-speaker-error-alert", async ({ page }) => {
    const { mock, mockHost, pageErrors, face, alerts } = await setup(page, { playlists: { [PLAYLIST]: [] } });
    const ctx = "ctx-err";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER });
    await expect.poll(() => face(ctx), { timeout: 8000 }).toBe(STATE.NOT_FAVORITE);
    // Playlist reads fail: the press cannot check for duplicates, so it adds nothing and alerts.
    mock.setFailure("contentDirectory", { mode: "fault500" });
    await mockHost.inject.keyDown(ctx);
    await expect.poll(async () => (await alerts(ctx)).length, { timeout: 8000 }).toBeGreaterThan(0);
    mock.setFailure("contentDirectory", null);
    expect(mock.playlistUris(PLAYLIST)).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
