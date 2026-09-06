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
async function commonSetup(page) {
  const mock = await installMockSonos(page, {
    topologyFixture: "zonegroupstate-single-group-single-member.xml",
  });
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

  const callsBefore = mock.calls.length;

  // fire 4 keyDown events back‑to‑back
  await mockHost.inject.keyDown("ctx1");
  await mockHost.inject.keyDown("ctx1");
  await mockHost.inject.keyDown("ctx1");
  await mockHost.inject.keyDown("ctx1");

  // give the rate‑limiter a moment to process (it is 500 ms)
  await page.waitForTimeout(600);

  // No new Sonos network calls should have been added
  expect(mock.calls.length).toBe(callsBefore);

  // Ensure only getter actions are present (i.e. no accidental command actions)
  const allowedActions = [...EXPECTED_GETTERS, "GetZoneGroupState"];
  const unexpected = mock.calls.filter((c) => !allowedActions.includes(c.action));
  expect(unexpected).toEqual([]);

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
test.fixme("p3-poll-renders-state", async () => {
  // Phase 5 will emit setImage/setState/setTitle frames.
});
test.fixme("p3-no-flashing-60s", async () => {
  // Phase 5 will ensure redrawCount===1 after the first render.
});
test.fixme("p3-timer-throttle-proof", async () => {
  // Phase 5 will need background‑tab cadence proof via rendered frames.
});
