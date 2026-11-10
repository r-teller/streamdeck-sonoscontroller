// p8 - Play Mode carousel dial (sonos-gen.3) and the shared touch-strip carousel (sonos-gen.1).
// Turning moves the carousel immediately; the mode is applied once turning stops. Push and tap
// both step to the next mode. Follows docs/adding-actions.md.
import { test, expect } from "@playwright/test";
import { mockStreamDeckHostSource, createMockHost, connect } from "./support/mockStreamDeckHost.js";
import { installMockSonos } from "./support/mockSonos.js";

const ACTION = "com.r-teller.sonoscontroller.encoder-play-mode";
const SPEAKER = { uuid: "RINCON_OFFICE01400", hostAddress: "192.168.1.42", zoneName: "Office" };
const SETTLE_MS = 600; // PLAY_MODE_DIAL_SETTLE_MS

const GETTER_FIXTURES = {
  GetTransportInfo: "gettransportinfo-playing.xml",
  GetTransportSettings: "gettransportsettings-shuffle.xml", // SHUFFLE_NOREPEAT
  GetMute: "getmute-unmuted-response.xml",
  GetVolume: "soap-getvolume-response.xml",
  GetBass: "getbass-response.xml",
  GetTreble: "gettreble-response.xml",
  GetPositionInfo: "getpositioninfo-spotify-track.xml",
};

// PLAY_MODES order in the plugin
const MODES = ["NORMAL", "SHUFFLE_NOREPEAT", "SHUFFLE_REPEAT_ONE", "SHUFFLE", "REPEAT_ONE", "REPEAT_ALL"];
const LABEL = {
  NORMAL: "Normal",
  SHUFFLE_NOREPEAT: "Shuffle No Repeat",
  SHUFFLE_REPEAT_ONE: "Shuffle Repeat One",
  SHUFFLE: "Shuffle",
  REPEAT_ONE: "Repeat One",
  REPEAT_ALL: "Repeat All",
};

async function setup(page, mockOptions = {}) {
  const mock = await installMockSonos(page, {
    topologyFixture: "zonegroupstate-single-group-single-member.xml",
    actionFixtures: { ...GETTER_FIXTURES },
    ...mockOptions,
  });
  await page.addInitScript(mockStreamDeckHostSource);
  await page.goto("/plugin.html");
  const mockHost = createMockHost(page);
  await connect(page, { uuid: "plugin-uuid-p8", registerEvent: "registerPlugin", actionInfo: null });
  const pageErrors = [];
  page.on("console", (msg) => {
    // Network failures injected by the mock are logged by the browser; they are not plugin errors.
    const text = msg.text();
    if (msg.type() === "error" && !text.includes("net::ERR") && !text.includes("Failed to load resource")) {
      pageErrors.push(text);
    }
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  const feedback = async (ctx) =>
    (await mockHost.outbound("setFeedback")).filter((f) => f.context === ctx).map((f) => f.payload);
  const shown = async (ctx) => (await feedback(ctx)).at(-1) ?? {};
  const sentModes = () =>
    mock.calls.filter((c) => c.action === "SetPlayMode").map((c) => c.body.match(/<NewPlayMode>([^<]*)</)[1]);
  /** The plugin re-polls right after an action: wait for a GetTransportSettings after the n-th SetPlayMode. */
  const afterNextPoll = async (n) => {
    await expect
      .poll(
        () => {
          const sets = mock.calls.filter((c) => c.action === "SetPlayMode");
          const i = mock.calls.indexOf(sets[n - 1]);
          return i >= 0 && mock.calls.slice(i + 1).some((c) => c.action === "GetTransportSettings");
        },
        { timeout: 8000 },
      )
      .toBe(true);
    await page.waitForTimeout(300);
  };
  return { mock, mockHost, pageErrors, feedback, shown, sentModes, afterNextPoll };
}

async function screenshotDial(page, frames, name) {
  await page.goto("/harness/key-preview.html");
  await page.evaluate((f) => window.renderFrames(f), frames);
  await page.screenshot({ path: `tests/playwright/screenshots/p8-${name}.png`, fullPage: true });
}

test.describe("p8 - Play Mode carousel dial", () => {
  test("p8-appear-carousel", async ({ page }) => {
    const { mockHost, shown, pageErrors } = await setup(page);
    const ctx = "ctx-pm-appear";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER }, "Encoder");

    await expect.poll(async () => (await shown(ctx)).caption, { timeout: 8000 }).toBe("Shuffle No Repeat");
    const fb = await shown(ctx);
    expect(fb.detail).toBe("2 / 6");
    expect(fb.cards).toMatch(/^data:image\/png;base64,/);
    const layouts = (await mockHost.outbound("setFeedbackLayout")).filter((f) => f.context === ctx);
    expect(layouts.at(-1).payload.layout).toBe("layouts/encoder-carousel.json");
    // The cards image really is 200 x 66 and not blank.
    const info = await page.evaluate(async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let lit = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++;
      return { w: img.width, h: img.height, lit };
    }, fb.cards);
    expect(info).toMatchObject({ w: 200, h: 66 });
    expect(info.lit).toBeGreaterThan(2000);

    await expect.poll(async () => (await page.evaluate(() => document.readyState)) === "complete").toBe(true);
    const frames = (await mockHost.outbound()).filter((f) => f.context === ctx);
    await screenshotDial(page, frames, "play-mode-carousel");
    expect(pageErrors).toEqual([]);
  });

  test("p8-rotate-moves-now-applies-when-turning-stops", async ({ page }) => {
    const { mockHost, shown, feedback, sentModes, afterNextPoll, pageErrors } = await setup(page);
    const ctx = "ctx-pm-rotate";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER }, "Encoder");
    await expect.poll(async () => (await shown(ctx)).caption, { timeout: 8000 }).toBe("Shuffle No Repeat");
    const before = (await feedback(ctx)).length;

    // +1: the carousel moves right away, the speaker is not touched yet.
    await mockHost.inject.dialRotate(ctx, 1);
    await expect.poll(async () => (await shown(ctx)).caption, { timeout: 2000 }).toBe("Shuffle Repeat One");
    expect((await shown(ctx)).detail).toBe("3 / 6");
    expect(sentModes()).toEqual([]);
    // the slide: several distinct card images while the caption is already the new mode
    await page.waitForTimeout(200);
    const slide = (await feedback(ctx)).slice(before).map((f) => f.cards);
    expect(new Set(slide).size).toBeGreaterThanOrEqual(3);

    // Turning stopped: exactly one SetPlayMode with the selected mode, and it sticks after the poll.
    await expect.poll(sentModes, { timeout: SETTLE_MS + 3000 }).toEqual(["SHUFFLE_REPEAT_ONE"]);
    await afterNextPoll(1);
    expect((await shown(ctx)).caption).toBe("Shuffle Repeat One");

    // -1: back
    await mockHost.inject.dialRotate(ctx, -1);
    await expect.poll(async () => (await shown(ctx)).caption, { timeout: 2000 }).toBe("Shuffle No Repeat");
    await expect.poll(sentModes, { timeout: SETTLE_MS + 3000 }).toEqual(["SHUFFLE_REPEAT_ONE", "SHUFFLE_NOREPEAT"]);
    expect(pageErrors).toEqual([]);
  });

  test("p8-burst-and-cancel-out", async ({ page }) => {
    const { mockHost, shown, sentModes, pageErrors } = await setup(page);
    const ctx = "ctx-pm-burst";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER }, "Encoder");
    await expect.poll(async () => (await shown(ctx)).caption, { timeout: 8000 }).toBe("Shuffle No Repeat");

    // +1 +1 +1 -1 quickly: one call, net +2
    for (const t of [1, 1, 1, -1]) await mockHost.inject.dialRotate(ctx, t);
    await expect.poll(async () => (await shown(ctx)).caption).toBe("Shuffle");
    await expect.poll(sentModes, { timeout: SETTLE_MS + 3000 }).toEqual(["SHUFFLE"]);
    await page.waitForTimeout(SETTLE_MS + 300);
    expect(sentModes()).toEqual(["SHUFFLE"]);

    // +1 -1: lands where it started, nothing sent
    await mockHost.inject.dialRotate(ctx, 1);
    await mockHost.inject.dialRotate(ctx, -1);
    await page.waitForTimeout(SETTLE_MS + 500);
    expect(sentModes()).toEqual(["SHUFFLE"]);
    expect((await shown(ctx)).caption).toBe("Shuffle");
    expect(pageErrors).toEqual([]);
  });

  test("p8-wraps-both-ways", async ({ page }) => {
    const { mock, mockHost, shown, sentModes, pageErrors } = await setup(page);
    mock.setActionFixture("GetTransportSettings", "gettransportsettings-repeatall.xml");
    const ctx = "ctx-pm-wrap";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER }, "Encoder");
    await expect.poll(async () => (await shown(ctx)).caption, { timeout: 8000 }).toBe("Repeat All");
    expect((await shown(ctx)).detail).toBe("6 / 6");

    // last -> first
    await mockHost.inject.dialRotate(ctx, 1);
    await expect.poll(async () => (await shown(ctx)).caption).toBe("Normal");
    await expect.poll(sentModes, { timeout: SETTLE_MS + 3000 }).toEqual(["NORMAL"]);
    // first -> last
    await mockHost.inject.dialRotate(ctx, -1);
    await expect.poll(async () => (await shown(ctx)).caption).toBe("Repeat All");
    await expect.poll(sentModes, { timeout: SETTLE_MS + 3000 }).toEqual(["NORMAL", "REPEAT_ALL"]);

    // all six modes, for the screenshot
    const frames = [];
    for (let i = 0; i < MODES.length; i++) {
      await mockHost.inject.dialRotate(ctx, 1);
      await page.waitForTimeout(150);
    }
    await expect.poll(sentModes, { timeout: SETTLE_MS + 3000 }).toHaveLength(2); // full lap: nothing new
    frames.push(...(await mockHost.outbound()).filter((f) => f.context === ctx));
    expect(pageErrors).toEqual([]);
  });

  test("p8-push-and-tap-next-mode", async ({ page }) => {
    const { mockHost, shown, sentModes, afterNextPoll, pageErrors } = await setup(page);
    const ctx = "ctx-pm-push";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER }, "Encoder");
    await expect.poll(async () => (await shown(ctx)).caption, { timeout: 8000 }).toBe("Shuffle No Repeat");

    await mockHost.inject.dialDown(ctx);
    await expect.poll(sentModes, { timeout: 4000 }).toEqual(["SHUFFLE_REPEAT_ONE"]);
    await expect.poll(async () => (await shown(ctx)).caption).toBe("Shuffle Repeat One");
    await afterNextPoll(1);
    expect((await shown(ctx)).caption).toBe("Shuffle Repeat One");

    await mockHost.inject.touchTap(ctx);
    await expect.poll(sentModes, { timeout: 4000 }).toEqual(["SHUFFLE_REPEAT_ONE", "SHUFFLE"]);
    await expect.poll(async () => (await shown(ctx)).caption).toBe("Shuffle");
    expect(pageErrors).toEqual([]);
  });

  test("p8-subset-of-modes", async ({ page }) => {
    const { mockHost, shown, sentModes, pageErrors } = await setup(page);
    const ctx = "ctx-pm-subset";
    const selectedPlayModes = ["NORMAL", "SHUFFLE", "REPEAT_ALL"];
    // Current mode SHUFFLE_NOREPEAT is not in the subset: shown as an extra first card.
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER, selectedPlayModes }, "Encoder");
    await expect.poll(async () => (await shown(ctx)).caption, { timeout: 8000 }).toBe("Shuffle No Repeat");
    expect((await shown(ctx)).detail).toBe("1 / 4");

    await mockHost.inject.dialRotate(ctx, 1);
    await expect.poll(sentModes, { timeout: SETTLE_MS + 3000 }).toEqual(["NORMAL"]);
    await expect.poll(async () => (await shown(ctx)).detail).toBe("1 / 3");

    // tap steps within the subset
    await mockHost.inject.touchTap(ctx);
    await expect.poll(sentModes, { timeout: 4000 }).toEqual(["NORMAL", "SHUFFLE"]);

    // settings changed in the PI: the carousel follows
    await mockHost.inject.didReceiveSettings(ctx, { ...SPEAKER, action: ACTION, selectedPlayModes: ["SHUFFLE", "NORMAL"] });
    await expect.poll(async () => (await shown(ctx)).detail).toBe("1 / 2");
    expect(pageErrors).toEqual([]);
  });

  test("p8-speaker-error", async ({ page }) => {
    const { mock, mockHost, shown, pageErrors } = await setup(page);
    const ctx = "ctx-pm-error";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER }, "Encoder");
    await expect.poll(async () => (await shown(ctx)).caption, { timeout: 8000 }).toBe("Shuffle No Repeat");

    // At most 3 failing gestures per test: more trips the rate limiter, which drops input silently.
    mock.setFailure("avTransport", { mode: "fault500" });
    await mockHost.inject.dialRotate(ctx, 1);
    await expect
      .poll(async () => (await mockHost.outbound("showAlert")).filter((f) => f.context === ctx).length, {
        timeout: SETTLE_MS + 4000,
      })
      .toBeGreaterThan(0);
    await mockHost.inject.touchTap(ctx);
    await expect
      .poll(async () => (await mockHost.outbound("showAlert")).filter((f) => f.context === ctx).length, { timeout: 4000 })
      .toBeGreaterThan(1);

    // recovery
    mock.setFailure("avTransport", null);
    await page.waitForTimeout(500);
    const frames = (await mockHost.outbound()).filter((f) => f.context === ctx);
    expect(pageErrors).toEqual([]);
    await screenshotDial(page, frames, "play-mode-error");
  });

  test("p8-pi-shows-play-mode-switches", async ({ page }) => {
    await installMockSonos(page, { topologyFixture: "zonegroupstate-single-group-single-member.xml" });
    await page.addInitScript(mockStreamDeckHostSource);
    await page.goto("/pi.html");
    await connect(page, {
      uuid: "pi-uuid-p8",
      registerEvent: "registerPropertyInspector",
      actionInfo: { action: ACTION, context: "ctx-pm-pi", payload: { settings: { ...SPEAKER }, controller: "Encoder" } },
    });
    await expect(page.locator('[data-pi-section="play-modes"]')).toBeVisible();
    await expect(page.locator('[data-pi-section="equalizer-target"]')).toHaveCount(0);
    await page.screenshot({ path: "tests/playwright/screenshots/p8-play-mode-pi.png", fullPage: true });
  });
});
