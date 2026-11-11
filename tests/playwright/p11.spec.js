// p11 - Heart badge on Currently Playing and Play/Pause (sonos-bg0.3): shown when the playing song
// is in the "Stream Deck Favorites" Sonos playlist; follows edits made in the Sonos app.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { mockStreamDeckHostSource, createMockHost, connect } from "./support/mockStreamDeckHost.js";
import { installMockSonos } from "./support/mockSonos.js";

const SPEAKER = { uuid: "RINCON_OFFICE01400", hostAddress: "192.168.1.42", zoneName: "Office" };
const NOW_PLAYING = "com.r-teller.sonoscontroller.currently-playing";
const PLAY_PAUSE = "com.r-teller.sonoscontroller.toggle-play-pause";
const VOLUME_UP = "com.r-teller.sonoscontroller.volume-up";
const COVER = readFileSync(join(process.cwd(), "tests/fixtures/art/cover.png"));
const PLAYLIST = "Stream Deck Favorites";
// The playing song (fixture getpositioninfo-spotify-id.xml), saved from another playlist: other flags/sn.
const SAME_SONG = "x-sonos-spotify:spotify%3atrack%3a6WvF2AJU3J9PR9OHSqqcuk?sid=12&flags=8224&sn=3";
const OTHER_SONG = "x-sonos-spotify:spotify%3atrack%3a6t3GC2nW76Lqx3kAwZixUi?sid=12&flags=8232&sn=7";

const GETTER_FIXTURES = {
  GetTransportInfo: "gettransportinfo-playing.xml",
  GetTransportSettings: "gettransportsettings-shuffle.xml",
  GetMute: "getmute-unmuted-response.xml",
  GetVolume: "soap-getvolume-response.xml",
  GetBass: "getbass-response.xml",
  GetTreble: "gettreble-response.xml",
  GetPositionInfo: "getpositioninfo-spotify-id.xml",
};

async function setup(page, { playlists = {} } = {}) {
  const mock = await installMockSonos(page, {
    topologyFixture: "zonegroupstate-single-group-single-member.xml",
    actionFixtures: GETTER_FIXTURES,
    playlists,
  });
  await page.route("**/getaa*", (route) => route.fulfill({ status: 200, contentType: "image/png", body: COVER }));
  await page.addInitScript(mockStreamDeckHostSource);
  await page.goto("/plugin.html");
  const mockHost = createMockHost(page);
  await connect(page, { uuid: "plugin-uuid-p11", registerEvent: "registerPlugin", actionInfo: null });
  await mockHost.inject.globalSettings({ deviceCheckInterval: 1 });
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("net::ERR")) pageErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  const lastImage = async (ctx) =>
    (await mockHost.outbound("setImage"))
      .filter((f) => f.context === ctx && typeof f.payload.image === "string")
      .map((f) => f.payload.image)
      .at(-1);
  const playlistBrowses = () => mock.calls.filter((c) => c.action === "Browse" && /<ObjectID>SQ:/.test(c.body ?? ""));
  return { mock, mockHost, pageErrors, lastImage, playlistBrowses };
}

/** True when the key image has the pink heart in its top-right badge. */
async function hasHeart(page, src) {
  if (!src || !src.startsWith("data:image")) return false;
  return page.evaluate(async (s) => {
    const img = new Image();
    img.src = s;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const [r, gr, b] = g.getImageData(116, 30, 1, 1).data;
    return r > 200 && gr < 140 && b > 70 && b < 160;
  }, src);
}

async function screenshotKey(page, mockHost, ctx, name) {
  const frames = (await mockHost.outbound()).filter((f) => f.context === ctx);
  await page.goto("/harness/key-preview.html");
  await page.evaluate((f) => window.renderFrames(f), frames);
  await page.screenshot({ path: `tests/playwright/screenshots/p11-${name}.png`, fullPage: true });
}

const art = { displayAlbumArt: true };

test.describe("p11 - heart badge", () => {
  test("p11-heart-for-song-in-playlist", async ({ page }) => {
    const { mockHost, pageErrors, lastImage } = await setup(page, { playlists: { [PLAYLIST]: [OTHER_SONG, SAME_SONG] } });
    const ctx = "ctx-heart";
    await mockHost.inject.willAppear(ctx, NOW_PLAYING, { ...SPEAKER, ...art });
    await expect.poll(async () => hasHeart(page, await lastImage(ctx)), { timeout: 8000 }).toBe(true);
    await screenshotKey(page, mockHost, ctx, "now-playing-heart");
    expect(pageErrors).toEqual([]);
  });

  test("p11-no-heart-for-other-songs", async ({ page }) => {
    const { mockHost, pageErrors, lastImage, playlistBrowses } = await setup(page, {
      playlists: { [PLAYLIST]: [OTHER_SONG] },
    });
    const ctx = "ctx-noheart";
    await mockHost.inject.willAppear(ctx, NOW_PLAYING, { ...SPEAKER, ...art });
    await expect.poll(() => playlistBrowses().length, { timeout: 8000 }).toBeGreaterThan(1);
    await page.waitForTimeout(500);
    expect(await hasHeart(page, await lastImage(ctx))).toBe(false);
    expect(pageErrors).toEqual([]);
  });

  test("p11-follows-sonos-app-edits", async ({ page }) => {
    const { mock, mockHost, pageErrors, lastImage } = await setup(page, { playlists: { [PLAYLIST]: [OTHER_SONG] } });
    const ctx = "ctx-edit";
    await mockHost.inject.willAppear(ctx, PLAY_PAUSE, { ...SPEAKER, ...art });
    await expect.poll(async () => (await lastImage(ctx)) ?? "", { timeout: 8000 }).toMatch(/^data:image/);
    expect(await hasHeart(page, await lastImage(ctx))).toBe(false);

    // Added in the Sonos app: the change counter moves, the next poll re-reads the songs.
    mock.editPlaylist(PLAYLIST, [OTHER_SONG, SAME_SONG]);
    await expect.poll(async () => hasHeart(page, await lastImage(ctx)), { timeout: 8000 }).toBe(true);

    // Removed in the app again.
    mock.editPlaylist(PLAYLIST, [OTHER_SONG]);
    await expect.poll(async () => hasHeart(page, await lastImage(ctx)), { timeout: 8000 }).toBe(false);
    expect(pageErrors).toEqual([]);
  });

  test("p11-setting-off", async ({ page }) => {
    const { mockHost, pageErrors, lastImage, playlistBrowses } = await setup(page, {
      playlists: { [PLAYLIST]: [SAME_SONG] },
    });
    const ctx = "ctx-off";
    await mockHost.inject.willAppear(ctx, NOW_PLAYING, { ...SPEAKER, ...art, displayFavoriteBadge: false });
    await expect.poll(async () => (await lastImage(ctx)) ?? "", { timeout: 8000 }).toMatch(/^data:image/);
    await page.waitForTimeout(2500);
    expect(await hasHeart(page, await lastImage(ctx))).toBe(false);
    expect(playlistBrowses()).toEqual([]); // nothing on this speaker needs the playlist
    expect(pageErrors).toEqual([]);
  });

  test("p11-no-playlist-searched-rarely", async ({ page }) => {
    const { mock, mockHost, pageErrors, lastImage, playlistBrowses } = await setup(page);
    const ctx = "ctx-none";
    await mockHost.inject.willAppear(ctx, NOW_PLAYING, { ...SPEAKER, ...art });
    await expect
      .poll(() => mock.calls.filter((c) => c.action === "GetPositionInfo").length, { timeout: 8000 })
      .toBeGreaterThan(3);
    expect(await hasHeart(page, await lastImage(ctx))).toBe(false);
    expect(playlistBrowses().length).toBe(1); // looked once; retried only after 30 s
    expect(pageErrors).toEqual([]);
  });

  test("p11-other-keys-do-not-read-playlists", async ({ page }) => {
    const { mock, mockHost, pageErrors, playlistBrowses } = await setup(page, { playlists: { [PLAYLIST]: [SAME_SONG] } });
    await mockHost.inject.willAppear("ctx-vol", VOLUME_UP, { ...SPEAKER });
    await expect
      .poll(() => mock.calls.filter((c) => c.action === "GetPositionInfo").length, { timeout: 8000 })
      .toBeGreaterThan(2);
    expect(playlistBrowses()).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
