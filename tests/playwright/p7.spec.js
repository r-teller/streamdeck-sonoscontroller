// p7 - Speaker Bindings: replacing a speaker that left the household (sonos-fq0).
//
// PI side: a button bound to a speaker absent from the household shows "Not found"; Replace writes a
// speakerReplacements mapping to global settings and Undo removes it.
// Plugin side: a replacement repoints the button (setSettings with the new uuid), and a button whose
// speaker id changed but whose room name still matches is repaired on willAppear.
import { test, expect } from "@playwright/test";
import { mockStreamDeckHostSource, createMockHost, connect } from "./support/mockStreamDeckHost.js";
import { installMockSonos } from "./support/mockSonos.js";

const OLD = "RINCON_GARAGEOLD01400";
const OFFICE = "RINCON_OFFICE01400";

// Matches tests/fixtures/sonos/zonegroupstate-multi-group.xml
const devices = {
  [OFFICE]: { uuid: OFFICE, zoneName: "Office", hostAddress: "192.168.1.42", isSatellite: false },
  RINCON_KITCHEN01400: { uuid: "RINCON_KITCHEN01400", zoneName: "Kitchen", hostAddress: "192.168.1.43", isSatellite: false },
  RINCON_DININGROOM01400: {
    uuid: "RINCON_DININGROOM01400",
    zoneName: "Dining Room",
    hostAddress: "192.168.1.44",
    isSatellite: false,
  },
  RINCON_PATIO01400: { uuid: "RINCON_PATIO01400", zoneName: "Patio", hostAddress: "192.168.1.45", isSatellite: false },
};

const ACTION = "com.r-teller.sonoscontroller.currently-playing";
const garageSettings = { uuid: OLD, zoneName: "Garage", hostAddress: "192.168.1.99", title: "Garage (192.168.1.99)" };

const GETTER_FIXTURES = {
  GetTransportInfo: "gettransportinfo-playing.xml",
  GetTransportSettings: "gettransportsettings-shuffle.xml",
  GetMute: "getmute-unmuted-response.xml",
  GetVolume: "soap-getvolume-response.xml",
  GetBass: "getbass-response.xml",
  GetTreble: "gettreble-response.xml",
  GetPositionInfo: "getpositioninfo-spotify-track.xml",
};

function trackErrors(page) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return () => errors.filter((e) => !e.includes("net::ERR") && !e.includes("Failed to load resource"));
}

async function lastReplacements(mockHost) {
  const frames = await mockHost.outbound("setGlobalSettings");
  return frames.at(-1)?.payload?.speakerReplacements;
}

test.describe("p7 - speaker replacement via Speaker Bindings", () => {
  test("p7-pi-replace-and-undo", async ({ page }) => {
    test.setTimeout(60_000);
    await installMockSonos(page, { topologyFixture: "zonegroupstate-multi-group.xml" });
    await page.addInitScript(mockStreamDeckHostSource);
    await page.goto("/pi.html");
    const errors = trackErrors(page);
    const mockHost = createMockHost(page);

    await connect(page, {
      uuid: "pi-uuid-p7",
      registerEvent: "registerPropertyInspector",
      actionInfo: { action: ACTION, context: "ctx-garage", payload: { settings: garageSettings, controller: "Keypad" } },
    });

    // The PI asks the plugin for on-screen bindings when it connects.
    await expect
      .poll(async () => (await mockHost.outbound("sendToPlugin")).some((f) => f.payload?.type === "getBindings"))
      .toBe(true);

    await mockHost.inject.globalSettings({ devices });
    // Plugin's reply: two buttons on screen still point at the departed Garage speaker.
    await page.evaluate(
      ({ action, bindings }) =>
        window.__sdInject({
          event: "sendToPropertyInspector",
          action,
          context: "ctx-garage",
          payload: { type: "bindings", bindings },
        }),
      {
        action: ACTION,
        bindings: [
          { uuid: OLD, zoneName: "Garage", hostAddress: "192.168.1.99", buttons: 2 },
          { uuid: OFFICE, zoneName: "Office", hostAddress: "192.168.1.42", buttons: 1 },
        ],
      },
    );

    // The action section flags the missing speaker; Fix opens the Speaker Bindings list.
    const missingAlert = page.locator("[data-pi-speaker-missing-alert]");
    await expect(missingAlert).toBeVisible();
    // Once a household is known, Global Settings collapses (Bootstrap animation). Let it settle first:
    // Bootstrap ignores show() while a hide transition is running, which a human click never hits.
    const globalsHeader = page.locator("#global-settings-accordeon .accordion-button");
    await expect(globalsHeader).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#global-settings-accordeon .collapsing")).toHaveCount(0);
    await page.locator("[data-pi-speaker-missing-fix]").click();
    await expect(globalsHeader).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#global-settings-accordeon .collapsing")).toHaveCount(0);

    const garageRow = page.locator(`[data-pi-binding="${OLD}"]`);
    await expect(garageRow).toBeVisible();
    await expect(garageRow).toHaveAttribute("data-pi-binding-status", "missing");
    await expect(garageRow).toContainText("Not found");
    await expect(garageRow).toContainText("2 buttons on screen");
    await expect(page.locator(`[data-pi-binding="${OFFICE}"]`)).toHaveAttribute("data-pi-binding-status", "online");
    await page.screenshot({ path: "tests/playwright/screenshots/p7-bindings-not-found.png", fullPage: true });

    // Replace Garage with Office.
    await mockHost.clearOutbound();
    await page.locator(`[data-pi-replace-select="${OLD}"]`).selectOption(OFFICE);
    await page.locator(`[data-pi-replace-apply="${OLD}"]`).click();

    await expect.poll(() => lastReplacements(mockHost)).toEqual({ [OLD]: OFFICE });
    const saved = (await mockHost.outbound("setGlobalSettings")).at(-1).payload;
    expect(Object.keys(saved.devices)).toEqual(Object.keys(devices));
    await expect(garageRow).toHaveAttribute("data-pi-binding-status", "replaced");
    await expect(page.locator(`[data-pi-replacement="${OLD}"]`)).toBeVisible();
    await expect(missingAlert).toHaveCount(0);
    // Fallback refresh: the PI asks for bindings again after saving.
    await expect
      .poll(async () => (await mockHost.outbound("sendToPlugin")).some((f) => f.payload?.type === "getBindings"))
      .toBe(true);
    await page.screenshot({ path: "tests/playwright/screenshots/p7-bindings-replaced.png", fullPage: true });

    // Undo removes the mapping and the speaker is "Not found" again.
    await page.locator(`[data-pi-replacement-undo="${OLD}"]`).click();
    await expect.poll(() => lastReplacements(mockHost)).toEqual({});
    await expect(garageRow).toHaveAttribute("data-pi-binding-status", "missing");
    await expect(page.locator("[data-pi-replacements]")).toHaveCount(0);
    await expect(missingAlert).toBeVisible();

    expect(errors()).toEqual([]);
  });

  test("p7-plugin-replacement-repoints-buttons", async ({ page }) => {
    test.setTimeout(60_000);
    const mock = await installMockSonos(page, {
      topologyFixture: "zonegroupstate-multi-group.xml",
      actionFixtures: GETTER_FIXTURES,
    });
    await page.addInitScript(mockStreamDeckHostSource);
    await page.goto("/plugin.html");
    const errors = trackErrors(page);
    const mockHost = createMockHost(page);
    await connect(page, { uuid: "plugin-uuid-p7", registerEvent: "registerPlugin", actionInfo: null });

    await mockHost.inject.globalSettings({ devices });
    await mockHost.inject.willAppear("ctx-garage-1", ACTION, garageSettings);
    await mockHost.inject.willAppear("ctx-garage-2", ACTION, garageSettings);

    // Unresolvable: the buttons keep their saved speaker until the user picks a replacement.
    await page.waitForTimeout(500);
    expect(await mockHost.outbound("setSettings")).toEqual([]);

    await mockHost.inject.globalSettings({ devices, speakerReplacements: { [OLD]: OFFICE } });

    await expect
      .poll(async () => (await mockHost.outbound("setSettings")).map((f) => f.context).sort())
      .toEqual(["ctx-garage-1", "ctx-garage-2"]);
    for (const frame of await mockHost.outbound("setSettings")) {
      expect(frame.payload).toMatchObject({
        uuid: OFFICE,
        hostAddress: "192.168.1.42",
        zoneName: "Office",
        title: "Office (192.168.1.42)",
      });
      // Runtime-only keys never reach Stream Deck.
      expect(frame.payload.status).toBeUndefined();
    }

    // Polling follows the new speaker.
    await expect
      .poll(() => mock.calls.filter((c) => String(c.host).includes("192.168.1.42") && c.action === "GetPositionInfo").length, {
        timeout: 8000,
      })
      .toBeGreaterThan(0);

    expect(errors()).toEqual([]);
  });

  test("p7-plugin-room-name-auto-repair-on-willAppear", async ({ page }) => {
    test.setTimeout(60_000);
    await installMockSonos(page, { topologyFixture: "zonegroupstate-multi-group.xml", actionFixtures: GETTER_FIXTURES });
    await page.addInitScript(mockStreamDeckHostSource);
    await page.goto("/plugin.html");
    const errors = trackErrors(page);
    const mockHost = createMockHost(page);
    await connect(page, { uuid: "plugin-uuid-p7", registerEvent: "registerPlugin", actionInfo: null });

    await mockHost.inject.globalSettings({ devices });
    // Office speaker was swapped for new hardware: new id and IP, same room name.
    await mockHost.inject.willAppear("ctx-office", ACTION, {
      uuid: "RINCON_OFFICEOLD01400",
      zoneName: "Office",
      hostAddress: "192.168.1.200",
      title: "Office (192.168.1.200)",
    });
    // No room match: left alone.
    await mockHost.inject.willAppear("ctx-garage", ACTION, garageSettings);

    await expect.poll(async () => (await mockHost.outbound("setSettings")).length).toBe(1);
    const [frame] = await mockHost.outbound("setSettings");
    expect(frame.context).toBe("ctx-office");
    expect(frame.payload).toMatchObject({ uuid: OFFICE, hostAddress: "192.168.1.42", zoneName: "Office" });

    await page.waitForTimeout(500);
    expect((await mockHost.outbound("setSettings")).filter((f) => f.context === "ctx-garage")).toEqual([]);

    expect(errors()).toEqual([]);
  });
});
