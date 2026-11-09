import path from "node:path";
import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { mockStreamDeckHostSource, createMockHost, connect } from "./support/mockStreamDeckHost.js";
import { installMockSonos } from "./support/mockSonos.js";

const PLUGIN_HTML = path.resolve("com.r-teller.sonoscontroller.sdPlugin/plugin.html");

test.beforeAll(() => {
  // sanity check – the built bundle must be present before any test runs
  expect(fs.existsSync(PLUGIN_HTML)).toBeTruthy();
});

/**
 * Helper to collect console errors for a test.
 */
async function collectConsoleErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

/**
 * Common setup used by all tests.
 */
async function commonSetup(page, mockOptions = {}) {
  const defaultOptions = {
    topologyFixture: "zonegroupstate-single-group-single-member.xml",
  };
  const mock = await installMockSonos(page, { ...defaultOptions, ...mockOptions });
  await page.addInitScript(mockStreamDeckHostSource);
  await page.goto("/plugin.html");
  const mockHost = createMockHost(page);
  await connect(page, {
    uuid: "plugin-uuid-p3",
    registerEvent: "registerPlugin",
    actionInfo: null,
  });
  const consoleErrors = await collectConsoleErrors(page);
  return { mock, mockHost, consoleErrors };
}

/**
 * Expected Sonos getter actions that the supervisor should fire for a fresh
 * speaker binding.
 */
const EXPECTED_GETTERS = [
  "GetTransportSettings",
  "GetTransportInfo",
  "GetMute",
  "GetVolume",
  "GetBass",
  "GetTreble",
  "GetPositionInfo",
];

test("p3-registration-and-poll-fanout", async ({ page }) => {
  const { mock, mockHost, consoleErrors } = await commonSetup(page);

  // 1️⃣ registration frame
  const outboundFrames = await mockHost.outbound();
  expect(outboundFrames[0]).toMatchObject({
    event: "registerPlugin",
    uuid: "plugin-uuid-p3",
  });

  // 2️⃣ bind a speaker (willAppear)
  await mockHost.inject.willAppear("ctx1", "com.r-teller.sonoscontroller.currently-playing", {
    uuid: "RINCON_OFFICE01400",
    hostAddress: "192.168.1.42",
    zoneName: "Office",
  });

  // 3️⃣ wait for the seven getter calls
  await expect
    .poll(
      async () => {
        return EXPECTED_GETTERS.every((a) => mock.calls.some((c) => c.action === a));
      },
      { timeout: 5000, intervals: [200] },
    )
    .toBeTruthy();

  // no console errors
  expect(consoleErrors).toEqual([]);
});

test("p3-disconnect-alert", async ({ page }) => {
  const { mock, mockHost, consoleErrors } = await commonSetup(page);

  // speed up polling
  await mockHost.inject.globalSettings({ deviceCheckInterval: 1 });

  // bind speaker
  await mockHost.inject.willAppear("ctx1", "com.r-teller.sonoscontroller.currently-playing", {
    uuid: "RINCON_OFFICE01400",
    hostAddress: "192.168.1.42",
    zoneName: "Office",
  });

  // wait for first fan‑out (same check as previous test)
  await expect
    .poll(
      async () => {
        return EXPECTED_GETTERS.every((a) => mock.calls.some((c) => c.action === a));
      },
      { timeout: 5000 },
    )
    .toBeTruthy();

  // induce failures on all three service keys
  mock.setFailure("avTransport", { mode: "abort" });
  mock.setFailure("rendering", { mode: "abort" });
  mock.setFailure("topology", { mode: "abort" });

  // expect a showAlert frame for ctx1
  await expect
    .poll(
      async () => {
        const out = await mockHost.outbound();
        return out.filter((f) => f.event === "showAlert" && f.context === "ctx1").length;
      },
      { timeout: 15000, intervals: [500] },
    )
    .toBeGreaterThan(0);

  // capture frames before leaving the page
  const frames = await mockHost.outbound();

  // render them in the preview harness
  await page.goto("/harness/key-preview.html");
  await page.evaluate((f) => window.renderFrames(f), frames);

  // verify the alert overlay is visible (display:flex)
  const alertDisplay = await page.evaluate(() => {
    const tile = window.getTile("ctx1");
    if (!tile) return "no-tile";
    const el = tile.el.querySelector(".tile-alert");
    return window.getComputedStyle(el).display;
  });
  expect(alertDisplay).toBe("flex");

  // screenshot for CI artefacts
  await page.screenshot({
    path: "tests/playwright/screenshots/p3-disconnect-alert.png",
    fullPage: true,
  });

  const realErrors = consoleErrors.filter((e) => !e.includes("net::ERR_CONNECTION_REFUSED"));
  expect(realErrors).toEqual([]);
});

test("p3-rate-limit", async ({ page }) => {
  const { mock, mockHost, consoleErrors } = await commonSetup(page);

  // bind speaker
  await mockHost.inject.willAppear("ctx1", "com.r-teller.sonoscontroller.currently-playing", {
    uuid: "RINCON_OFFICE01400",
    hostAddress: "192.168.1.42",
    zoneName: "Office",
  });

  // wait for the initial fan‑out
  await expect
    .poll(
      async () => {
        return EXPECTED_GETTERS.every((a) => mock.calls.some((c) => c.action === a));
      },
      { timeout: 5000 },
    )
    .toBeTruthy();

  // ADJUDICATION (Phase 5): with real action handlers wired, a keyDown on
  // currently-playing legitimately fires exactly 6 getters. The rate limiter
  // allows MAX 3 update attempts per rolling 10 s window; a transition to
  // UPDATED (successful completion) resets the window — spec behavior. With
  // instant mock responses each press completed (→ UPDATED → window reset)
  // before the next arrived, so no press was ever rate-limited. The scenario's
  // INTENT is: 4 genuinely rapid presses → the 4th produces NO network call.
  // Fix: delay responses so handler flights outlast the 4 injections, then
  // assert the call log grew by EXACTLY 24 (3 presses x [6 getters + 2
  // connect-time GetZoneGroupState]; verified against the live call log).

  // Let the in-flight initial poll complete (instant responses) so its
  // UPDATED transition resets the rate-limit window before the presses.
  await page.waitForTimeout(500);

  const callsBefore = mock.calls.length;

  // Apply long delays to keep the network calls in flight, ensuring the rate-limiter triggers.
  mock.setFailure("avTransport", { mode: "delay", ms: 1500 });
  mock.setFailure("rendering", { mode: "delay", ms: 1500 });

  // Inject four rapid keyDown events.
  for (let i = 0; i < 4; i++) {
    await mockHost.inject.keyDown("ctx1");
  }

  // Expect exactly 3 x 8 = 24 new calls (the 4th press should produce none).
  // Each press = 6 getters + 2 connect-time GetZoneGroupState calls (the
  // controller's connect() resolves topology/coordinator per dispatch).
  const expectedCalls = callsBefore + 24;
  await expect.poll(() => mock.calls.length, { timeout: 10000 }).toBe(expectedCalls);

  // After the presses settle, the only further traffic is ONE confirming re-poll (a successful
  // action schedules an immediate re-check, sonos-e9y) and nothing from the rate-limited 4th press.
  await page.waitForTimeout(2000);
  const extra = mock.calls.slice(expectedCalls);
  expect(extra.every((c) => String(c.action).startsWith("Get"))).toBe(true);
  expect(extra.filter((c) => c.action === "GetVolume")).toHaveLength(1);

  // No console errors should have been emitted.
  expect(consoleErrors).toEqual([]);
});

test("p3-wake-noop", async ({ page }) => {
  const { mock, mockHost, consoleErrors } = await commonSetup(page);

  // speed up polling
  await mockHost.inject.globalSettings({ deviceCheckInterval: 1 });

  // bind speaker
  await mockHost.inject.willAppear("ctx1", "com.r-teller.sonoscontroller.currently-playing", {
    uuid: "RINCON_OFFICE01400",
    hostAddress: "192.168.1.42",
    zoneName: "Office",
  });

  // wait for first fan‑out
  await expect
    .poll(
      async () => {
        return EXPECTED_GETTERS.every((a) => mock.calls.some((c) => c.action === a));
      },
      { timeout: 5000 },
    )
    .toBeTruthy();

  const callsBefore = mock.calls.length;

  // inject systemDidWakeUp – should be a no‑op
  await page.evaluate(() => window.__sdInject({ event: "systemDidWakeUp" }));

  // immediate check – no extra calls
  expect(mock.calls.length).toBe(callsBefore);

  // later, the regular poll should fire again
  await expect.poll(() => mock.calls.length, { timeout: 5000, intervals: [200] }).toBeGreaterThan(callsBefore);

  // no alert frames should have been emitted
  const outbound = await mockHost.outbound();
  const alerts = outbound.filter((f) => f.event === "showAlert");
  expect(alerts).toEqual([]);

  expect(consoleErrors).toEqual([]);
});

/* -------------------------------------------------------------------------- */
/*  FIXME placeholders – to be enabled in Phase 5 when render state functions */
/*  are wired into the runtime.                                               */
/* -------------------------------------------------------------------------- */
test("p3-poll-renders-state", async ({ page }) => {
  // Install mock Sonos with fixtures for all seven poll getters.
  const { mockHost, consoleErrors } = await commonSetup(page, {
    actionFixtures: {
      GetTransportInfo: "gettransportinfo-playing.xml",
      GetTransportSettings: "gettransportsettings-shuffle.xml",
      GetMute: "getmute-unmuted-response.xml",
      GetVolume: "soap-getvolume-response.xml",
      GetBass: "getbass-response.xml",
      GetTreble: "gettreble-response.xml",
      GetPositionInfo: "getpositioninfo-spotify-track.xml",
    },
  });

  // Bind the toggle-play-pause action with state-based title enabled.
  await mockHost.inject.willAppear(
    "ctx1",
    "com.r-teller.sonoscontroller.toggle-play-pause",
    {
      uuid: "RINCON_OFFICE01400",
      hostAddress: "192.168.1.42",
      zoneName: "Office",
      displayStateBasedTitle: true,
    },
    "Keypad",
  );

  // Wait until the plugin emits both setTitle ("Playing") and setState (1) frames.
  await expect
    .poll(
      async () => {
        const frames = await mockHost.outbound();
        const title = frames.find((f) => f.event === "setTitle" && f.context === "ctx1");
        const state = frames.find((f) => f.event === "setState" && f.context === "ctx1");
        return title?.payload?.title === "Playing" && state?.payload?.state === 1;
      },
      { timeout: 8000 },
    )
    .toBeTruthy();

  // Capture the outbound frames for rendering.
  const frames = await mockHost.outbound();

  // Render the frames in the preview harness.
  await page.goto("/harness/key-preview.html");
  await page.evaluate((f) => window.renderFrames(f), frames);

  // Verify the tile displays the expected title and state.
  const titleText = await page.evaluate(() => {
    const tile = window.getTile("ctx1");
    return tile.el.querySelector(".tile-title").textContent.trim();
  });
  const stateText = await page.evaluate(() => {
    const tile = window.getTile("ctx1");
    const el = tile.el.querySelector(".tile-state");
    return el ? el.textContent.trim() : "";
  });

  expect(titleText).toBe("Playing");
  expect(stateText).toBe("1");

  // Screenshot the rendered tile.
  await page.screenshot({
    path: "tests/playwright/screenshots/p3-playing-tile.png",
    fullPage: true,
  });

  // Ensure no console errors were logged.
  expect(consoleErrors).toEqual([]);
});
test("p3-no-flashing-60s", async ({ page }) => {
  test.setTimeout(150000);

  const { mock, mockHost, consoleErrors } = await commonSetup(page, {
    actionFixtures: {
      GetTransportInfo: "gettransportinfo-playing.xml",
      GetTransportSettings: "gettransportsettings-shuffle.xml",
      GetMute: "getmute-unmuted-response.xml",
      GetVolume: "soap-getvolume-response.xml",
      GetBass: "getbass-response.xml",
      GetTreble: "gettreble-response.xml",
      GetPositionInfo: "getpositioninfo-spotify-track.xml",
    },
  });

  await mockHost.inject.globalSettings({ deviceCheckInterval: 1 });
  await mockHost.inject.willAppear(
    "ctx1",
    "com.r-teller.sonoscontroller.toggle-play-pause",
    {
      uuid: "RINCON_OFFICE01400",
      hostAddress: "192.168.1.42",
      zoneName: "Office",
      displayStateBasedTitle: true,
    },
    "Keypad",
  );

  await expect
    .poll(async () => mock.calls.filter((c) => c.action === "GetTransportInfo").length, { timeout: 120000, intervals: [1000] })
    .toBeGreaterThanOrEqual(60);

  const frames = await mockHost.outbound();

  await page.goto("/harness/key-preview.html");
  await page.evaluate((f) => window.renderFrames(f), frames);

  const redrawCount = await page.evaluate(() => window.getRedrawCount("ctx1"));
  expect(redrawCount).toBe(1);

  const setTitleFrames = frames.filter((f) => f.context === "ctx1" && f.event === "setTitle");
  const setStateFrames = frames.filter((f) => f.context === "ctx1" && f.event === "setState");
  expect(setTitleFrames).toHaveLength(1);
  expect(setStateFrames).toHaveLength(1);

  await page.screenshot({
    path: "tests/playwright/screenshots/p3-no-flashing-60s.png",
    fullPage: true,
  });

  expect(consoleErrors).toEqual([]);
});
test("p3-timer-throttle-proof", async ({ page, context }) => {
  test.setTimeout(60000);

  const { mock, mockHost, consoleErrors } = await commonSetup(page, {
    actionFixtures: {
      GetTransportInfo: "gettransportinfo-playing.xml",
      GetTransportSettings: "gettransportsettings-shuffle.xml",
      GetMute: "getmute-unmuted-response.xml",
      GetVolume: "soap-getvolume-response.xml",
      GetBass: "getbass-response.xml",
      GetTreble: "gettreble-response.xml",
      GetPositionInfo: "getpositioninfo-spotify-track.xml",
    },
  });

  await mockHost.inject.globalSettings({ deviceCheckInterval: 1 });
  await mockHost.inject.willAppear(
    "ctx1",
    "com.r-teller.sonoscontroller.toggle-play-pause",
    {
      uuid: "RINCON_OFFICE01400",
      hostAddress: "192.168.1.42",
      zoneName: "Office",
      displayStateBasedTitle: true,
    },
    "Keypad",
  );

  await expect
    .poll(async () => mock.calls.filter((c) => c.action === "GetTransportInfo").length, { timeout: 120000, intervals: [1000] })
    .toBeGreaterThanOrEqual(2);

  const page2 = await context.newPage();
  await page2.goto("about:blank");
  await page2.bringToFront();

  const countBefore = mock.calls.filter((c) => c.action === "GetTransportInfo").length;

  await page2.waitForTimeout(6000);

  const countAfter = mock.calls.filter((c) => c.action === "GetTransportInfo").length;

  expect(countAfter - countBefore).toBeGreaterThanOrEqual(4);

  await page2.close();

  expect(consoleErrors).toEqual([]);
});
