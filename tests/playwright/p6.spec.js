import path from "node:path";
import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { mockStreamDeckHostSource, createMockHost, connect } from "./support/mockStreamDeckHost.js";
import { installMockSonos } from "./support/mockSonos.js";

const GETTER_FIXTURES = {
  GetTransportInfo: "gettransportinfo-playing.xml",
  GetTransportSettings: "gettransportsettings-shuffle.xml",
  GetMute: "getmute-unmuted-response.xml",
  GetVolume: "soap-getvolume-response.xml",
  GetBass: "getbass-response.xml",
  GetTreble: "gettreble-response.xml",
  GetPositionInfo: "getpositioninfo-spotify-track.xml",
};

async function commonSetup(page, mockOptions = {}) {
  const defaultOptions = { topologyFixture: "zonegroupstate-multi-group.xml" };
  const mock = await installMockSonos(page, { ...defaultOptions, ...mockOptions });
  await page.addInitScript(mockStreamDeckHostSource);
  await page.goto("/plugin.html");
  const mockHost = createMockHost(page);
  await connect(page, { uuid: "plugin-uuid-p6", registerEvent: "registerPlugin", actionInfo: null });
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));
  return { mock, mockHost, consoleErrors };
}

test.describe("p6 - user journeys", () => {
  test("p6-journey-first-run", async ({ page }) => {
    test.setTimeout(60_000);

    const mock = await installMockSonos(page, {
      topologyFixture: "zonegroupstate-multi-group.xml",
      favoritesFixture: "browse-fv2-mixed.xml",
      actionFixtures: { ...GETTER_FIXTURES },
    });
    await page.addInitScript(mockStreamDeckHostSource);
    await page.goto("/pi.html");
    const mockHost = createMockHost(page);
    const consoleErrors = [];
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
    page.on("pageerror", (err) => consoleErrors.push(err.message));
    await mockHost.clearOutbound();
    await connect(page, {
      uuid: "pi-uuid-p6",
      registerEvent: "registerPropertyInspector",
      actionInfo: {
        action: "com.r-teller.sonoscontroller.currently-playing",
        context: "ctx-p6",
        payload: { settings: {}, controller: "Keypad" }
      }
    });

    const disconnectedHint = page.locator("[data-pi-disconnected-hint]");
    await expect(disconnectedHint).toBeVisible();

    const addressInput = page.locator("[data-pi-primary-device-address]");
    await addressInput.fill("192.168.1.42");

    const saveButton = page.locator("[data-pi-save-and-connect]");
    await expect(saveButton).toBeEnabled();

    await saveButton.click();

    const spinner = page.locator("[data-pi-save-and-connect-spinner]");
    await expect(spinner).not.toBeVisible({ timeout: 15_000 });

    const picker = page.locator("[data-pi-speaker-picker]");
    await expect(picker.locator("option")).toHaveCount(4);

    await expect.poll(async () => (await mockHost.outbound("setSettings")).length, { timeout: 8000 }).toBe(1);
    const boundSettings = (await mockHost.outbound("setSettings"))[0].payload;
    expect(boundSettings.uuid).toBe("RINCON_OFFICE01400");

    const globalSettingsFrames = await mockHost.outbound("setGlobalSettings");
    expect(globalSettingsFrames.length).toBeGreaterThan(0);
    expect(globalSettingsFrames[0].payload.devices).toBeDefined();

    await page.goto("/plugin.html");
    const mockHostPlugin = createMockHost(page);
    await connect(page, { uuid: "plugin-uuid-p6", registerEvent: "registerPlugin", actionInfo: null });

    const ctxFr = "ctx-fr";
    await mockHostPlugin.inject.willAppear(ctxFr, "com.r-teller.sonoscontroller.currently-playing", boundSettings);

    await expect.poll(() => mock.calls.filter((c) => c.action === "GetPositionInfo").length, { timeout: 8000 }).toBeGreaterThan(0);

    await expect.poll(async () => {
      const frames = await mockHostPlugin.outbound();
      return frames.filter((f) => ["setTitle", "setImage"].includes(f.event) && f.context === ctxFr).length;
    }, { timeout: 8000 }).toBeGreaterThan(0);

    const frames = (await mockHostPlugin.outbound()).filter((f) => ["setTitle", "setState", "setImage"].includes(f.event));
    await page.goto("/harness/key-preview.html");
    await page.evaluate((f) => window.renderFrames(f), frames);
    await page.screenshot({ path: "tests/playwright/screenshots/p6-journey-first-run.png", fullPage: true });

    expect(consoleErrors.filter((e) => !e.includes("net::ERR") && !e.includes("Failed to load resource"))).toEqual([]);
  });

  test("p6-journey-two-speakers", async ({ page }) => {
    test.setTimeout(60_000);

    const { mock, mockHost, consoleErrors } = await commonSetup(page, {
      actionFixtures: { ...GETTER_FIXTURES },
    });

    const ctxOffice = "ctx-office";
    const ctxDining = "ctx-dining";

    await mockHost.inject.willAppear(ctxOffice, "com.r-teller.sonoscontroller.toggle-play-pause", {
      uuid: "RINCON_OFFICE01400",
      hostAddress: "192.168.1.42",
      zoneName: "Office",
      displayStateBasedTitle: true,
    });

    await mockHost.inject.willAppear(ctxDining, "com.r-teller.sonoscontroller.toggle-mute-unmute", {
      uuid: "RINCON_DININGROOM01400",
      hostAddress: "192.168.1.44",
      zoneName: "Dining Room",
      displayStateBasedTitle: true,
    });

    await expect
      .poll(async () => {
        const calls = mock.calls;
        const officeCalls = calls.filter((c) => c.host === "192.168.1.42");
        const diningCalls = calls.filter((c) => c.host === "192.168.1.44");
        return officeCalls.length > 0 && diningCalls.length > 0;
      }, { timeout: 8000 })
      .toBe(true);

    await expect.poll(async () => {
      const frames = await mockHost.outbound();
      return frames.filter((f) => f.event === "setTitle" && f.context === ctxOffice).pop()?.payload?.title;
    }, { timeout: 8000 }).toBe("Playing");

    await expect.poll(async () => {
      const frames = await mockHost.outbound();
      return frames.filter((f) => f.event === "setTitle" && f.context === ctxDining).pop()?.payload?.title;
    }, { timeout: 8000 }).toBe("Unmuted");

    await mock.setActionFixture("GetTransportInfo", "gettransportinfo-paused.xml");
    await mockHost.inject.globalSettings({ deviceCheckInterval: 1 });

    await expect
      .poll(async () => {
        const frames = await mockHost.outbound();
        return frames.filter((f) => f.event === "setTitle" && f.context === ctxOffice).pop()?.payload?.title;
      }, { timeout: 8000 })
      .toBe("Paused");

    await expect
      .poll(async () => {
        const frames = await mockHost.outbound();
        return frames.filter((f) => f.event === "setTitle" && f.context === ctxDining).pop()?.payload?.title;
      }, { timeout: 8000 })
      .toBe("Unmuted");

    const alertFrames = await mockHost.outbound("showAlert");
    expect(alertFrames.length).toBe(0);

    const frames = (await mockHost.outbound()).filter((f) => ["setTitle", "setState", "setImage"].includes(f.event));
    await page.goto("/harness/key-preview.html");
    await page.evaluate((f) => window.renderFrames(f), frames);
    await page.screenshot({ path: "tests/playwright/screenshots/p6-journey-two-speakers.png", fullPage: true });

    expect(consoleErrors.filter((e) => !e.includes("net::ERR") && !e.includes("Failed to load resource"))).toEqual([]);
  });

  test("p6-journey-morgan", async ({ page }) => {
    test.setTimeout(60_000);

    const { mock, mockHost, consoleErrors } = await commonSetup(page, {
      actionFixtures: { ...GETTER_FIXTURES },
    });

    const ctxEq = "ctx-eq";
    await mockHost.inject.willAppear(ctxEq, "encoder-audio-equalizer", {
      uuid: "RINCON_OFFICE01400",
      hostAddress: "192.168.1.42",
      zoneName: "Office",
    }, "Encoder");

    await expect
      .poll(async () => {
        const frames = await mockHost.outbound();
        return frames.find((f) => f.event === "setFeedback" && f.context === ctxEq && f.payload.value === 42);
      }, { timeout: 8000 })
      .toBeDefined();

    await mockHost.inject.dialRotate(ctxEq, 1);

    await expect.poll(() => mock.calls.filter((c) => c.action === "SetVolume").length, { timeout: 8000 }).toBe(1);
    const setVolumeCall = mock.calls.find((c) => c.action === "SetVolume");
    expect(setVolumeCall.body).toContain("<DesiredVolume>43</DesiredVolume>");

    await expect
      .poll(async () => {
        const frames = await mockHost.outbound();
        return frames.find((f) => f.event === "setFeedback" && f.context === ctxEq && f.payload.value === 43);
      }, { timeout: 8000 })
      .toBeDefined();

    const ctxInput = "ctx-input";
    await mockHost.inject.willAppear(ctxInput, "com.r-teller.sonoscontroller.toggle-input-source", {
      uuid: "RINCON_DININGROOM01400",
      hostAddress: "192.168.1.44",
      zoneName: "Dining Room",
      displayStateBasedTitle: true,
    });

    await mockHost.inject.keyDown(ctxInput);

    await expect.poll(() => mock.calls.filter((c) => c.action === "SetAVTransportURI").length, { timeout: 8000 }).toBe(1);
    const setAvTransportCall = mock.calls.find((c) => c.action === "SetAVTransportURI");
    expect(setAvTransportCall.host).toBe("192.168.1.43");
    expect(setAvTransportCall.body).toContain("x-sonos-htastream:RINCON_KITCHEN01400:spdif");

    await expect.poll(() => mock.calls.filter((c) => c.action === "Play").length, { timeout: 8000 }).toBe(1);
    const playCall = mock.calls.find((c) => c.action === "Play");
    expect(playCall.host).toBe("192.168.1.43");

    const ctxNow = "ctx-now";
    const initialGetPositionInfoCount = mock.calls.filter((c) => c.action === "GetPositionInfo").length;
    await mockHost.inject.willAppear(ctxNow, "com.r-teller.sonoscontroller.currently-playing", {
      uuid: "RINCON_OFFICE01400",
      hostAddress: "192.168.1.42",
      zoneName: "Office",
    });

    await mockHost.inject.keyDown(ctxNow);

    await expect
      .poll(() => {
        const calls = mock.calls;
        return calls.filter((c) => c.action === "GetPositionInfo").length;
      }, { timeout: 8000 })
      .toBeGreaterThan(initialGetPositionInfoCount);

    const frames = (await mockHost.outbound()).filter((f) => ["setTitle", "setState", "setImage"].includes(f.event));
    await page.goto("/harness/key-preview.html");
    await page.evaluate((f) => window.renderFrames(f), frames);
    await page.screenshot({ path: "tests/playwright/screenshots/p6-journey-morgan.png", fullPage: true });

    expect(consoleErrors.filter((e) => !e.includes("net::ERR") && !e.includes("Failed to load resource"))).toEqual([]);
  });
});
