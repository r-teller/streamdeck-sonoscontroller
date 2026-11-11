// p10 - Track time on Currently Playing and Play/Pause keys (sonos-bg0.2): remaining time above a
// progress bar, drawn over the album art, counting down between polls. Follows docs/adding-actions.md.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { mockStreamDeckHostSource, createMockHost, connect } from "./support/mockStreamDeckHost.js";
import { installMockSonos } from "./support/mockSonos.js";

const SPEAKER = { uuid: "RINCON_OFFICE01400", hostAddress: "192.168.1.42", zoneName: "Office" };
const NOW_PLAYING = "com.r-teller.sonoscontroller.currently-playing";
const PLAY_PAUSE = "com.r-teller.sonoscontroller.toggle-play-pause";
const COVER = readFileSync(join(process.cwd(), "tests/fixtures/art/cover.png"));

// Long-title fixture: 1:23 of 4:21, album "Ocean Blvd", art at /getaa?u=art1.
const GETTER_FIXTURES = {
  GetTransportInfo: "gettransportinfo-playing.xml",
  GetTransportSettings: "gettransportsettings-shuffle.xml",
  GetMute: "getmute-unmuted-response.xml",
  GetVolume: "soap-getvolume-response.xml",
  GetBass: "getbass-response.xml",
  GetTreble: "gettreble-response.xml",
  GetPositionInfo: "getpositioninfo-long-title.xml",
};

async function setup(page, fixtures = {}) {
  const mock = await installMockSonos(page, {
    topologyFixture: "zonegroupstate-single-group-single-member.xml",
    actionFixtures: { ...GETTER_FIXTURES, ...fixtures },
  });
  await page.route("**/getaa*", (route) => route.fulfill({ status: 200, contentType: "image/png", body: COVER }));
  await page.addInitScript(mockStreamDeckHostSource);
  await page.goto("/plugin.html");
  const mockHost = createMockHost(page);
  await connect(page, { uuid: "plugin-uuid-p10", registerEvent: "registerPlugin", actionInfo: null });
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().includes("net::ERR")) pageErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  const images = async (ctx) =>
    (await mockHost.outbound("setImage"))
      .filter((f) => f.context === ctx && typeof f.payload.image === "string")
      .map((f) => f.payload.image);
  const titles = async (ctx) =>
    (await mockHost.outbound("setTitle")).filter((f) => f.context === ctx).map((f) => f.payload.title);
  return { mock, mockHost, pageErrors, images, titles };
}

/** Brightness of the bar row at the left end (filled part) and the right end (empty track). */
async function barPixels(page, src) {
  return page.evaluate(async (s) => {
    const img = new Image();
    img.src = s;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const lum = (x, y) => {
      const d = g.getImageData(x, y, 1, 1).data;
      return Math.round((d[0] + d[1] + d[2]) / 3);
    };
    return { size: img.width, filled: lum(18, 133), empty: lum(124, 133) };
  }, src);
}

async function screenshotKey(page, mockHost, ctx, name) {
  const frames = (await mockHost.outbound()).filter((f) => f.context === ctx);
  await page.goto("/harness/key-preview.html");
  await page.evaluate((f) => window.renderFrames(f), frames);
  await page.screenshot({ path: `tests/playwright/screenshots/p10-${name}.png`, fullPage: true });
}

// A key image with time drawn on it: a PNG that is not just the plain cover.
const PLAIN_COVER = `data:image/png;base64,${COVER.toString("base64")}`;
const composed = (src) => src.startsWith("data:image/png") && src !== PLAIN_COVER;

test.describe("p10 - track time", () => {
  test("p10-now-playing-time-and-bar", async ({ page }) => {
    const { mockHost, pageErrors, images, titles } = await setup(page);
    const ctx = "ctx-time";
    await mockHost.inject.willAppear(ctx, NOW_PLAYING, {
      ...SPEAKER,
      displayAlbumArt: true,
      displayMarqueeAlbumTitle: true,
    });

    await expect.poll(async () => (await images(ctx)).filter(composed).length, { timeout: 8000 }).toBeGreaterThan(0);
    const first = (await images(ctx)).filter(composed).at(-1);
    const px = await barPixels(page, first);
    expect(px.size).toBe(144);
    expect(px.filled).toBeGreaterThan(200); // white fill at 1:23 of 4:21
    expect(px.empty).toBeLessThan(170); // grey track beyond it

    // The album line moves up to the second row, clear of the time at the bottom.
    await expect.poll(async () => (await titles(ctx)).at(-1) ?? "").toMatch(/^\n[^\n]+$/);

    // Counts down between polls: the image changes about once a second while playing.
    const before = new Set(await images(ctx));
    await page.waitForTimeout(2600);
    const after = (await images(ctx)).filter((s) => !before.has(s) && composed(s));
    expect(after.length).toBeGreaterThanOrEqual(2);

    await screenshotKey(page, mockHost, ctx, "now-playing-time");
    expect(pageErrors).toEqual([]);
  });

  test("p10-paused-time-stops", async ({ page }) => {
    const { mockHost, pageErrors, images } = await setup(page, { GetTransportInfo: "gettransportinfo-paused.xml" });
    const ctx = "ctx-paused";
    await mockHost.inject.willAppear(ctx, NOW_PLAYING, { ...SPEAKER, displayAlbumArt: true });
    await expect.poll(async () => (await images(ctx)).filter(composed).length, { timeout: 8000 }).toBeGreaterThan(0);
    await page.waitForTimeout(600);
    const count = (await images(ctx)).length;
    await page.waitForTimeout(2600);
    expect((await images(ctx)).length).toBe(count);
    expect(pageErrors).toEqual([]);
  });

  test("p10-radio-elapsed-no-bar", async ({ page }) => {
    const { mockHost, pageErrors, images } = await setup(page, { GetPositionInfo: "getpositioninfo-radio.xml" });
    const ctx = "ctx-radio";
    await mockHost.inject.willAppear(ctx, NOW_PLAYING, { ...SPEAKER, displayAlbumArt: true });
    await expect.poll(async () => (await images(ctx)).filter(composed).length, { timeout: 8000 }).toBeGreaterThan(0);
    const px = await barPixels(page, (await images(ctx)).filter(composed).at(-1));
    expect(px.filled).toBeLessThan(170); // no bar
    await screenshotKey(page, mockHost, ctx, "radio-elapsed");
    expect(pageErrors).toEqual([]);
  });

  test("p10-setting-off", async ({ page }) => {
    const { mockHost, pageErrors, images, titles } = await setup(page);
    const ctx = "ctx-off";
    await mockHost.inject.willAppear(ctx, NOW_PLAYING, {
      ...SPEAKER,
      displayAlbumArt: true,
      displayMarqueeAlbumTitle: true,
      displayTrackTime: false,
    });
    await expect.poll(async () => (await images(ctx)).length, { timeout: 8000 }).toBeGreaterThan(0);
    // The plain cover (nothing drawn on it), and the album stays on the bottom row.
    await expect.poll(async () => (await images(ctx)).at(-1)).toBe(PLAIN_COVER);
    await expect.poll(async () => (await titles(ctx)).at(-1) ?? "").toMatch(/^\n\n\n[^\n]+$/);
    const count = (await images(ctx)).length;
    await page.waitForTimeout(2600);
    expect((await images(ctx)).length).toBe(count); // nothing ticks
    expect(pageErrors).toEqual([]);
  });

  test("p10-play-pause-key-time", async ({ page }) => {
    const { mockHost, pageErrors, images } = await setup(page);
    const ctx = "ctx-pp";
    await mockHost.inject.willAppear(ctx, PLAY_PAUSE, { ...SPEAKER, displayAlbumArt: true, displayStateBasedTitle: true });
    await expect.poll(async () => (await images(ctx)).filter(composed).length, { timeout: 8000 }).toBeGreaterThan(0);
    expect((await barPixels(page, (await images(ctx)).filter(composed).at(-1))).filled).toBeGreaterThan(200);
    await screenshotKey(page, mockHost, ctx, "play-pause-time");
    expect(pageErrors).toEqual([]);
  });

  test("p10-tv-no-time", async ({ page }) => {
    const { mockHost, pageErrors, images } = await setup(page, { GetPositionInfo: "getpositioninfo-tv.xml" });
    const ctx = "ctx-tv";
    await mockHost.inject.willAppear(ctx, NOW_PLAYING, { ...SPEAKER, displayAlbumArt: true });
    await expect.poll(async () => (await images(ctx)).at(-1), { timeout: 8000 }).toBe("./images/keys/input_tv.png");
    expect(pageErrors).toEqual([]);
  });
});
