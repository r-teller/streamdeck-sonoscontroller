// p9 - Queue Track carousel dial (sonos-gen.2). Turning browses the speaker's queue right away; the
// track under the centre card plays once turning stops. Push and tap play the next track now.
// Follows docs/adding-actions.md.
import { test, expect } from "@playwright/test";
import { mockStreamDeckHostSource, createMockHost, connect } from "./support/mockStreamDeckHost.js";
import { installMockSonos } from "./support/mockSonos.js";
import { waitForPollAfter } from "./support/polling.js";

const ACTION = "com.r-teller.sonoscontroller.encoder-queue-track";
const SPEAKER = { uuid: "RINCON_OFFICE01400", hostAddress: "192.168.1.42", zoneName: "Office" };
const SETTLE_MS = 1000; // QUEUE_DIAL_SETTLE_MS

// Queue fixture browse-q0-five-tracks.xml: "Track One".."Track Five" by "Artist A".."Artist E".
// GetPositionInfo fixture: track 3 is playing.
const GETTER_FIXTURES = {
  GetTransportInfo: "gettransportinfo-playing.xml",
  GetTransportSettings: "gettransportsettings-shuffle.xml",
  GetMute: "getmute-unmuted-response.xml",
  GetVolume: "soap-getvolume-response.xml",
  GetBass: "getbass-response.xml",
  GetTreble: "gettreble-response.xml",
  GetPositionInfo: "getpositioninfo-spotify-track.xml",
  GetMediaInfo: "getmediainfo-queue.xml",
};
const TITLES = ["Track One", "Track Two", "Track Three", "Track Four", "Track Five"];

async function setup(page, { fixtures = {}, ...mockOptions } = {}) {
  const mock = await installMockSonos(page, {
    topologyFixture: "zonegroupstate-single-group-single-member.xml",
    queueFixture: "browse-q0-five-tracks.xml",
    actionFixtures: { ...GETTER_FIXTURES, ...fixtures },
    ...mockOptions,
  });
  await page.addInitScript(mockStreamDeckHostSource);
  await page.goto("/plugin.html");
  const mockHost = createMockHost(page);
  await connect(page, { uuid: "plugin-uuid-p9", registerEvent: "registerPlugin", actionInfo: null });
  const pageErrors = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error" && !text.includes("net::ERR") && !text.includes("Failed to load resource")) {
      pageErrors.push(text);
    }
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  const shown = async (ctx) => (await mockHost.outbound("setFeedback")).filter((f) => f.context === ctx).at(-1)?.payload ?? {};
  const seeks = () =>
    mock.calls
      .filter((c) => c.action === "Seek")
      .map((c) => `${c.body.match(/<Unit>([^<]*)</)[1]}:${c.body.match(/<Target>([^<]*)</)[1]}`);
  const plays = () => mock.calls.filter((c) => c.action === "Play").length;
  const afterNextPoll = (n) => waitForPollAfter(page, mock, { set: "Seek", get: "GetPositionInfo", n });
  return { mock, mockHost, pageErrors, shown, seeks, plays, afterNextPoll };
}

async function screenshotDial(page, frames, name) {
  await page.goto("/harness/key-preview.html");
  await page.evaluate((f) => window.renderFrames(f), frames);
  await page.screenshot({ path: `tests/playwright/screenshots/p9-${name}.png`, fullPage: true });
}

test.describe("p9 - Queue Track carousel dial", () => {
  test("p9-appear-centred-on-playing-track", async ({ page }) => {
    const { mockHost, shown, pageErrors } = await setup(page);
    const ctx = "ctx-q-appear";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER }, "Encoder");

    await expect.poll(async () => (await shown(ctx)).caption, { timeout: 8000 }).toBe("Track Three");
    const fb = await shown(ctx);
    expect(fb.detail).toBe("Artist C · 3 / 5");
    expect(fb.cards).toMatch(/^data:image\/png;base64,/);
    const layouts = (await mockHost.outbound("setFeedbackLayout")).filter((f) => f.context === ctx);
    expect(layouts.at(-1).payload.layout).toBe("layouts/encoder-carousel.json");

    const frames = (await mockHost.outbound()).filter((f) => f.context === ctx);
    await screenshotDial(page, frames, "queue-carousel");
    expect(pageErrors).toEqual([]);
  });

  test("p9-rotate-browses-now-plays-when-turning-stops", async ({ page }) => {
    const { mockHost, shown, seeks, plays, afterNextPoll, pageErrors } = await setup(page);
    const ctx = "ctx-q-rotate";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER }, "Encoder");
    await expect.poll(async () => (await shown(ctx)).caption, { timeout: 8000 }).toBe("Track Three");

    await mockHost.inject.dialRotate(ctx, 1);
    await expect.poll(async () => (await shown(ctx)).caption, { timeout: 2000 }).toBe("Track Four");
    expect((await shown(ctx)).detail).toBe("Artist D · 4 / 5");
    // still browsing: nothing played yet, even past the normal dial debounce
    await page.waitForTimeout(500);
    expect(seeks()).toEqual([]);

    await expect.poll(seeks, { timeout: SETTLE_MS + 3000 }).toEqual(["TRACK_NR:4"]);
    expect(plays()).toBe(1);
    // the selection follows the playing track after the next poll
    await afterNextPoll(1);
    expect((await shown(ctx)).caption).toBe("Track Four");

    await mockHost.inject.dialRotate(ctx, -1);
    await expect.poll(async () => (await shown(ctx)).caption).toBe("Track Three");
    await expect.poll(seeks, { timeout: SETTLE_MS + 3000 }).toEqual(["TRACK_NR:4", "TRACK_NR:3"]);
    expect(pageErrors).toEqual([]);
  });

  test("p9-burst-and-cancel-out", async ({ page }) => {
    const { mockHost, shown, seeks, pageErrors } = await setup(page);
    const ctx = "ctx-q-burst";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER }, "Encoder");
    await expect.poll(async () => (await shown(ctx)).caption, { timeout: 8000 }).toBe("Track Three");

    for (const t of [1, 1, -1]) await mockHost.inject.dialRotate(ctx, t);
    await expect.poll(async () => (await shown(ctx)).caption).toBe("Track Four");
    await expect.poll(seeks, { timeout: SETTLE_MS + 3000 }).toEqual(["TRACK_NR:4"]);

    await mockHost.inject.dialRotate(ctx, 1);
    await mockHost.inject.dialRotate(ctx, -1);
    await page.waitForTimeout(SETTLE_MS + 600);
    expect(seeks()).toEqual(["TRACK_NR:4"]);
    expect(pageErrors).toEqual([]);
  });

  test("p9-wraps-both-ways", async ({ page }) => {
    const { mockHost, shown, seeks, pageErrors } = await setup(page);
    const ctx = "ctx-q-wrap";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER }, "Encoder");
    await expect.poll(async () => (await shown(ctx)).caption, { timeout: 8000 }).toBe("Track Three");

    // 3 -> 4 -> 5 -> 1
    for (let i = 0; i < 3; i++) await mockHost.inject.dialRotate(ctx, 1);
    await expect.poll(async () => (await shown(ctx)).caption).toBe("Track One");
    await expect.poll(seeks, { timeout: SETTLE_MS + 3000 }).toEqual(["TRACK_NR:1"]);
    // 1 -> 5
    await mockHost.inject.dialRotate(ctx, -1);
    await expect.poll(async () => (await shown(ctx)).caption).toBe("Track Five");
    await expect.poll(seeks, { timeout: SETTLE_MS + 3000 }).toEqual(["TRACK_NR:1", "TRACK_NR:5"]);
    expect(pageErrors).toEqual([]);
  });

  test("p9-push-and-tap-next-track", async ({ page }) => {
    const { mockHost, shown, seeks, plays, pageErrors } = await setup(page);
    const ctx = "ctx-q-push";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER }, "Encoder");
    await expect.poll(async () => (await shown(ctx)).caption, { timeout: 8000 }).toBe("Track Three");

    // push: next track immediately (well before the turn settle time)
    await mockHost.inject.dialDown(ctx);
    await expect.poll(seeks, { timeout: 800 }).toEqual(["TRACK_NR:4"]);
    expect(plays()).toBe(1);
    await expect.poll(async () => (await shown(ctx)).caption).toBe("Track Four");

    await mockHost.inject.touchTap(ctx);
    await expect.poll(seeks, { timeout: 800 }).toEqual(["TRACK_NR:4", "TRACK_NR:5"]);
    await expect.poll(async () => (await shown(ctx)).caption).toBe("Track Five");

    // last -> first
    await mockHost.inject.touchTap(ctx);
    await expect.poll(seeks, { timeout: 800 }).toEqual(["TRACK_NR:4", "TRACK_NR:5", "TRACK_NR:1"]);
    expect(pageErrors).toEqual([]);
  });

  test("p9-not-playing-from-queue", async ({ page }) => {
    const { mock, mockHost, shown, seeks, pageErrors } = await setup(page, {
      fixtures: { GetMediaInfo: "getmediainfo-radio.xml" },
    });
    const ctx = "ctx-q-radio";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER }, "Encoder");
    await expect.poll(async () => (await shown(ctx)).caption, { timeout: 8000 }).toBe("Not playing from queue");
    // a single dimmed queue icon above the message, no track cards
    expect((await shown(ctx)).detail).toBe("");

    await mockHost.inject.dialRotate(ctx, 1);
    await mockHost.inject.dialDown(ctx);
    await mockHost.inject.touchTap(ctx);
    await page.waitForTimeout(SETTLE_MS + 600);
    expect(seeks()).toEqual([]);
    expect(mock.calls.filter((c) => c.action === "Play")).toHaveLength(0);
    expect((await shown(ctx)).caption).toBe("Not playing from queue");

    const frames = (await mockHost.outbound()).filter((f) => f.context === ctx);
    await screenshotDial(page, frames, "queue-not-on-queue");
    expect(pageErrors).toEqual([]);
  });

  test("p9-empty-queue", async ({ page }) => {
    const { mockHost, shown, seeks, pageErrors } = await setup(page, { queueFixture: "browse-q0-empty.xml" });
    const ctx = "ctx-q-empty";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER }, "Encoder");
    await expect.poll(async () => (await shown(ctx)).caption, { timeout: 8000 }).toBe("Queue is empty");
    await mockHost.inject.dialRotate(ctx, 1);
    await page.waitForTimeout(SETTLE_MS + 600);
    expect(seeks()).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("p9-queue-change-refreshes-cards", async ({ page }) => {
    const { mock, mockHost, shown, pageErrors } = await setup(page);
    const ctx = "ctx-q-change";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER }, "Encoder");
    await expect.poll(async () => (await shown(ctx)).caption, { timeout: 8000 }).toBe("Track Three");

    // Queue replaced from the Sonos app: new UpdateID and titles. A key press triggers a re-poll.
    mock.setActionFixture("Browse", "browse-q0-five-tracks-v2.xml");
    await mockHost.inject.dialDown(ctx);
    await expect.poll(async () => (await shown(ctx)).caption, { timeout: 8000 }).toBe("New Four");
    expect(pageErrors).toEqual([]);
  });

  test("p9-speaker-error", async ({ page }) => {
    const { mock, mockHost, shown, seeks, pageErrors } = await setup(page);
    const ctx = "ctx-q-error";
    await mockHost.inject.willAppear(ctx, ACTION, { ...SPEAKER }, "Encoder");
    await expect.poll(async () => (await shown(ctx)).caption, { timeout: 8000 }).toBe("Track Three");

    // At most 3 failing gestures per test (rate limiter).
    mock.setFailure("avTransport", { mode: "fault500" });
    await mockHost.inject.dialRotate(ctx, 1);
    await expect.poll(seeks, { timeout: SETTLE_MS + 3000 }).toEqual(["TRACK_NR:4"]);
    await expect
      .poll(async () => (await mockHost.outbound("showAlert")).filter((f) => f.context === ctx).length, {
        timeout: 4000,
      })
      .toBeGreaterThan(0);
    // nothing was played: the carousel goes back to the playing track
    await expect.poll(async () => (await shown(ctx)).caption, { timeout: 4000 }).toBe("Track Three");
    mock.setFailure("avTransport", null);
    expect(pageErrors).toEqual([]);
  });
});
