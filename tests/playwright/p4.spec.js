import { test, expect } from "@playwright/test";
import { installMockSonos } from "./support/mockSonos.js";
import { mockStreamDeckHostSource, createMockHost, connect } from "./support/mockStreamDeckHost.js";

const actions = [
  { short: "currently-playing", uuid: "com.r-teller.sonoscontroller.currently-playing" },
  { short: "toggle-mute-unmute", uuid: "com.r-teller.sonoscontroller.toggle-mute-unmute" },
  { short: "toggle-play-pause", uuid: "com.r-teller.sonoscontroller.toggle-play-pause" },
  { short: "toggle-play-mode", uuid: "com.r-teller.sonoscontroller.toggle-play-mode" },
  { short: "toggle-input-source", uuid: "com.r-teller.sonoscontroller.toggle-input-source" },
  { short: "play-next-track", uuid: "com.r-teller.sonoscontroller.play-next-track" },
  { short: "play-previous-track", uuid: "com.r-teller.sonoscontroller.play-previous-track" },
  { short: "volume-up", uuid: "com.r-teller.sonoscontroller.volume-up" },
  { short: "volume-down", uuid: "com.r-teller.sonoscontroller.volume-down" },
  { short: "play-sonos-favorite", uuid: "com.r-teller.sonoscontroller.play-sonos-favorite" },
  { short: "encoder-audio-equalizer", uuid: "com.r-teller.sonoscontroller.encoder-audio-equalizer" }
];

async function bootPi(page, shortName, settings = {}) {
  await page.addInitScript(mockStreamDeckHostSource);
  await page.goto("/pi.html");
  const mockHost = createMockHost(page);
  await mockHost.clearOutbound();
  await connect(page, {
    uuid: "pi-uuid-p4",
    registerEvent: "registerPropertyInspector",
    actionInfo: {
      action: actions.find(a => a.short === shortName).uuid,
      context: "ctx-p4",
      payload: { settings, controller: "Keypad" }
    }
  });
  return mockHost;
}

async function expandAccordion(page, selector) {
  const header = page.locator(`${selector} .accordion-button`);
  const content = page.locator(`${selector} .accordion-collapse`);
  const expanded = await header.getAttribute("aria-expanded");
  if (expanded !== "true") {
    await header.click();
  }
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await expect(content).toHaveClass(/(?:^|\s)show(?:\s|$)/);
  await expect(content).not.toHaveClass(/collapsing/);
}

async function collapseAccordion(page, selector) {
  const header = page.locator(`${selector} .accordion-button`);
  const content = page.locator(`${selector} .accordion-collapse`);
  const expanded = await header.getAttribute("aria-expanded");
  if (expanded !== "false") {
    await header.click();
  }
  await expect(header).toHaveAttribute("aria-expanded", "false");
  await expect(content).not.toHaveClass(/show|collapsing/);
}

test("p4-first-run", async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  const mock = await installMockSonos(page, {
    topologyFixture: "zonegroupstate-live-bonded-and-grouped.xml",
    favoritesFixture: "browse-fv2-mixed.xml",
    failures: { topology: { mode: "delay", ms: 1500 } }
  });

  await page.addInitScript(mockStreamDeckHostSource);
  await page.goto("/pi.html");
  const mockHost = createMockHost(page);
  await mockHost.clearOutbound();

  await connect(page, {
    uuid: "pi-uuid-p4",
    registerEvent: "registerPropertyInspector",
    actionInfo: {
      action: "com.r-teller.sonoscontroller.volume-up",
      context: "ctx-p4",
      payload: { settings: {}, controller: "Keypad" }
    }
  });

  // Assert disconnected state
  const disconnectedHint = page.locator("[data-pi-disconnected-hint]");
  await expect(disconnectedHint).toHaveText("Set the Primary Device Address below and tap \"Save and Connect\" to discover your speakers.");
  const saveButton = page.locator("[data-pi-save-and-connect]");
  await expect(saveButton).toBeDisabled();
  await expect(saveButton).toHaveText("Save and Connect");
  await page.screenshot({ path: "tests/playwright/screenshots/p4-empty.png" });

  // Fill address and click connect
  const addressInput = page.locator("[data-pi-primary-device-address]");
  await addressInput.fill("192.168.1.10");
  await expect(saveButton).toBeEnabled();
  await saveButton.click();

  // Assert spinner visible
  const spinner = page.locator("[data-pi-save-and-connect-spinner]");
  await expect(spinner).toBeVisible();
  await expect(saveButton).toBeDisabled();
  await page.screenshot({ path: "tests/playwright/screenshots/p4-connecting.png" });

  // Wait for spinner to detach
  await expect(spinner).not.toBeVisible({ timeout: 15_000 });

  // Assert picker options
  const picker = page.locator("[data-pi-speaker-picker]");
  const options = picker.locator("option");
  await expect(options).toHaveCount(6);
  const optionLabels = (await options.allTextContents()).map((t) => t.trim());
  const expectedLabels = [
    "Bedroom (192.168.1.20)",
    "Living Room (192.168.1.10)",
    "Living Room (192.168.1.11) 🛰️",
    "Living Room (192.168.1.12) 🛰️",
    "Living Room (192.168.1.13) 🛰️",
    "Office (192.168.1.30)"
  ];
  expect(optionLabels).toEqual(expectedLabels);

  // Assert global accordion collapsed
  const globalAccordionHeader = page.locator("#global-settings-accordeon .accordion-button");
  await expect(globalAccordionHeader).toHaveAttribute("aria-expanded", "false");

  // Assert button label
  await expect(saveButton).toHaveText("Save and Reconnect");

  // Assert outbound frames
  const setGlobalSettingsFrames = await mockHost.outbound("setGlobalSettings");
  expect(setGlobalSettingsFrames).toHaveLength(1);
  const globalSettingsPayload = setGlobalSettingsFrames[0].payload;
  expect(globalSettingsPayload.devices).toBeDefined();
  expect(globalSettingsPayload.devices.RINCON_LIVINGROOMBAR01400.zoneName).toBe("Living Room");
  expect(globalSettingsPayload.favorites).toHaveLength(12);

  await expect.poll(async () => (await mockHost.outbound("setSettings")).length).toBe(1);
  const setSettingsFrames = await mockHost.outbound("setSettings");
  expect(setSettingsFrames).toHaveLength(1);
  expect(setSettingsFrames[0].payload.uuid).toBe("RINCON_LIVINGROOMBAR01400");
  expect(Object.keys(setSettingsFrames[0].payload)).toHaveLength(22);

  // Assert bound speaker alert
  const boundAlert = page.locator("[data-pi-bound-speaker-alert]");
  await expect(boundAlert).toBeVisible();
  await expect(boundAlert).toContainText("Living Room (192.168.1.10)");

  // Expand speakers accordion and screenshot
  await expandAccordion(page, "#sonos-speakers-accordeon");
  await page.screenshot({ path: "tests/playwright/screenshots/p4-connected.png" });
});

test("p4-discovery-failure", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const mock = await installMockSonos(page, {
    topologyFixture: "zonegroupstate-multi-group.xml",
    failures: { topology: { mode: "hang", ms: 5000 } }
  });

  await page.addInitScript(mockStreamDeckHostSource);
  await page.goto("/pi.html");
  const mockHost = createMockHost(page);
  await mockHost.clearOutbound();

  await connect(page, {
    uuid: "pi-uuid-p4",
    registerEvent: "registerPropertyInspector",
    actionInfo: {
      action: "com.r-teller.sonoscontroller.volume-up",
      context: "ctx-p4",
      payload: { settings: {}, controller: "Keypad" }
    }
  });

  const addressInput = page.locator("[data-pi-primary-device-address]");
  await addressInput.fill("192.168.1.42");
  const timeoutInput = page.locator("[data-pi-device-timeout-duration]");
  await timeoutInput.fill("2");
  const saveButton = page.locator("[data-pi-save-and-connect]");
  await saveButton.click();

  const errorAlert = page.locator("[data-pi-error-alert]");
  await expect(errorAlert).toBeVisible({ timeout: 20_000 });
  await expect(errorAlert).toContainText("Failed to get devices: Timeout while reaching 192.168.1.42:1400 after 2 seconds");
  await page.screenshot({ path: "tests/playwright/screenshots/p4-error.png" });

  const spinner = page.locator("[data-pi-save-and-connect-spinner]");
  await expect(spinner).not.toBeVisible();

  await expect(saveButton).toBeEnabled();

  const setGlobalSettingsFrames = await mockHost.outbound("setGlobalSettings");
  expect(setGlobalSettingsFrames).toHaveLength(0);

  await page.locator("[data-pi-error-dismiss]").click();
  await expect(errorAlert).not.toBeVisible();

  mock.setFailure("topology", null);
  await saveButton.click();

  await expect(spinner).not.toBeVisible({ timeout: 15_000 });

  const picker = page.locator("[data-pi-speaker-picker]");
  await expect(picker.locator("option")).toHaveCount(4);
  await expect(saveButton).toHaveText("Save and Reconnect");
});

for (const action of actions) {
  test(`p4-per-action-render-${action.short}`, async ({ page }) => {
    await page.addInitScript(mockStreamDeckHostSource);
    await page.goto("/pi.html");
    const mockHost = createMockHost(page);
    await mockHost.clearOutbound();

    await connect(page, {
      uuid: "pi-uuid-p4",
      registerEvent: "registerPropertyInspector",
      actionInfo: {
        action: action.uuid,
        context: "ctx-p4",
        payload: { settings: {}, controller: "Keypad" }
      }
    });

    const sections = {
      "play-modes": page.locator("[data-pi-section='play-modes']"),
      "input-sources": page.locator("[data-pi-section='input-sources']"),
      "equalizer-target": page.locator("[data-pi-section='equalizer-target']"),
      "sonos-favorites": page.locator("[data-pi-section='sonos-favorites']"),
      "volume-increment-override": page.locator("[data-pi-section='volume-increment-override']")
    };

    const toggles = {
      "state-based-title": page.locator("[data-pi-toggle-state-based-title]"),
      "marquee-title": page.locator("[data-pi-toggle-marquee-title]"),
      "marquee-album-title": page.locator("[data-pi-toggle-marquee-album-title]"),
      "album-art": page.locator("[data-pi-toggle-album-art]")
    };

    const expected = {
      "currently-playing": {
        togglesPresent: ["marquee-title", "marquee-album-title", "album-art"],
        sectionsPresent: []
      },
      "toggle-mute-unmute": {
        togglesPresent: ["state-based-title"],
        sectionsPresent: []
      },
      "toggle-play-pause": {
        togglesPresent: ["state-based-title", "marquee-album-title", "album-art"],
        sectionsPresent: []
      },
      "toggle-play-mode": {
        togglesPresent: ["state-based-title"],
        sectionsPresent: ["play-modes"]
      },
      "toggle-input-source": {
        togglesPresent: ["state-based-title"],
        sectionsPresent: ["input-sources"]
      },
      "play-next-track": {
        togglesPresent: ["state-based-title"],
        sectionsPresent: []
      },
      "play-previous-track": {
        togglesPresent: ["state-based-title"],
        sectionsPresent: []
      },
      "volume-up": {
        togglesPresent: ["state-based-title"],
        sectionsPresent: ["volume-increment-override"]
      },
      "volume-down": {
        togglesPresent: ["state-based-title"],
        sectionsPresent: ["volume-increment-override"]
      },
      "play-sonos-favorite": {
        // Favorite keys use their own five toggles (sonos-gw5), checked below.
        togglesPresent: [],
        favoriteToggles: true,
        sectionsPresent: ["sonos-favorites"]
      },
      "encoder-audio-equalizer": {
        togglesPresent: [],
        sectionsPresent: ["equalizer-target"]
      }
    };

    const config = expected[action.short];

    // Assert toggles
    for (const [name, locator] of Object.entries(toggles)) {
      const present = config.togglesPresent.includes(name);
      if (present) {
        await expect(locator).toBeVisible();
      } else {
        await expect(locator).not.toBeVisible();
      }
    }

    const favoriteToggles = page.locator("[data-pi-favorite-toggle]");
    if (config.favoriteToggles) {
      await expect(favoriteToggles).toHaveCount(5);
    } else {
      await expect(favoriteToggles).toHaveCount(0);
    }

    const togglesSection = page.locator("[data-pi-section='presentation-toggles']");
    if (config.togglesPresent.length > 0 || config.favoriteToggles) {
      await expect(togglesSection).toBeVisible();
    } else {
      await expect(togglesSection).not.toBeVisible();
    }

    // Assert sections
    for (const [name, locator] of Object.entries(sections)) {
      const present = config.sectionsPresent.includes(name);
      if (present) {
        await expect(locator).toBeVisible();
      } else {
        await expect(locator).not.toBeVisible();
      }
    }

    // Assert global settings section always present
    await expect(page.locator("[data-pi-section='global-settings']")).toBeVisible();

    // Play modes: assert 6 switches in canonical order
    if (action.short === "toggle-play-mode") {
      const playModes = [
        "NORMAL",
        "SHUFFLE_NOREPEAT",
        "SHUFFLE_REPEAT_ONE",
        "SHUFFLE",
        "REPEAT_ONE",
        "REPEAT_ALL"
      ];
      for (const mode of playModes) {
        const switchEl = page.locator(`[data-pi-play-mode="${mode}"]`);
        await expect(switchEl).toBeVisible();
      }
    }

    // Input sources: assert 3 switches
    if (action.short === "toggle-input-source") {
      const inputSources = ["Sonos_Queue", "TV_Input", "Line_In"];
      for (const source of inputSources) {
        const switchEl = page.locator(`[data-pi-input-source="${source}"]`);
        await expect(switchEl).toBeVisible();
      }
    }

    // EQ target: assert select exists
    if (action.short === "encoder-audio-equalizer") {
      const eqSelect = page.locator("[data-pi-eq-target-select]");
      await expect(eqSelect).toBeVisible();
    }

    // Favorites: assert select exists
    if (action.short === "play-sonos-favorite") {
      const favSelect = page.locator("[data-pi-favorite-select]");
      await expect(favSelect).toBeVisible();
    }

    // Volume override: assert input exists
    if (action.short === "volume-up" || action.short === "volume-down") {
      const volInput = page.locator("[data-pi-volume-increment-override]");
      await expect(volInput).toBeVisible();
    }

    await page.screenshot({ path: `tests/playwright/screenshots/p4-action-${action.short}.png` });
  });
}

test("p4-bind-speaker", async ({ page }) => {
  await installMockSonos(page, {
    topologyFixture: "zonegroupstate-multi-group.xml"
  });

  await page.addInitScript(mockStreamDeckHostSource);
  await page.goto("/pi.html");
  const mockHost = createMockHost(page);
  await mockHost.clearOutbound();

  await connect(page, {
    uuid: "pi-uuid-p4",
    registerEvent: "registerPropertyInspector",
    actionInfo: {
      action: "com.r-teller.sonoscontroller.volume-up",
      context: "ctx-p4",
      payload: { settings: {}, controller: "Keypad" }
    }
  });

  await mockHost.inject.globalSettings({
    devices: {
      "RINCON_OFFICE01400": {
        uuid: "RINCON_OFFICE01400",
        zoneName: "Office",
        hostAddress: "192.168.1.42",
        port: 1400,
        isSatellite: false,
        idleState: "ACTIVE",
        primary: false
      },
      "RINCON_KITCHEN01400": {
        uuid: "RINCON_KITCHEN01400",
        zoneName: "Kitchen",
        hostAddress: "192.168.1.43",
        port: 1400,
        isSatellite: false,
        idleState: "ACTIVE",
        primary: false
      },
      "RINCON_DININGROOM01400": {
        uuid: "RINCON_DININGROOM01400",
        zoneName: "Dining Room",
        hostAddress: "192.168.1.44",
        port: 1400,
        isSatellite: false,
        idleState: "ACTIVE",
        primary: false
      },
      "RINCON_PATIO01400": {
        uuid: "RINCON_PATIO01400",
        zoneName: "Patio",
        hostAddress: "192.168.1.45",
        port: 1400,
        isSatellite: false,
        idleState: "ACTIVE",
        primary: false
      }
    },
    deviceCheckInterval: 10,
    deviceTimeoutDuration: 10,
    adjustVolumeIncrement: 10,
    favorites: []
  });

  const saveButton = page.locator("[data-pi-save-and-connect]");
  await expect(saveButton).toHaveText("Save and Reconnect");

  await expandAccordion(page, "#sonos-speakers-accordeon");

  await mockHost.clearOutbound();

  const picker = page.locator("[data-pi-speaker-picker]");
  await picker.selectOption({ value: "RINCON_OFFICE01400" });

  await expect.poll(async () => (await mockHost.outbound("setSettings")).length).toBe(1);
  const setSettingsFrames = await mockHost.outbound("setSettings");
  expect(setSettingsFrames).toHaveLength(1);
  const payload = setSettingsFrames[0].payload;
  expect(Object.keys(payload)).toHaveLength(22);
  expect(payload.uuid).toBe("RINCON_OFFICE01400");
  expect(payload.title).toBe("Office (192.168.1.42)");
  expect(payload.hostAddress).toBe("192.168.1.42");
  expect(payload.zoneName).toBe("Office");
  expect(payload.adjustVolumeIncrement).toBeNull();
  expect(payload.selectedPlayModes).toBeNull();
  expect(payload.displayStateBasedTitle).toBe(false);

  const boundAlert = page.locator("[data-pi-bound-speaker-alert]");
  await expect(boundAlert).toBeVisible();
  await expect(boundAlert).toContainText("Office (192.168.1.42)");

  await collapseAccordion(page, "#sonos-speakers-accordeon");
  await expect(boundAlert).toBeVisible();

  await page.screenshot({ path: "tests/playwright/screenshots/p4-bound.png" });
});

test("p4-filter", async ({ page }) => {
  await installMockSonos(page, {
    topologyFixture: "zonegroupstate-live-bonded-and-grouped.xml"
  });

  await page.addInitScript(mockStreamDeckHostSource);
  await page.goto("/pi.html");
  const mockHost = createMockHost(page);
  await mockHost.clearOutbound();

  await connect(page, {
    uuid: "pi-uuid-p4",
    registerEvent: "registerPropertyInspector",
    actionInfo: {
      action: "com.r-teller.sonoscontroller.volume-up",
      context: "ctx-p4",
      payload: { settings: {}, controller: "Keypad" }
    }
  });

  await mockHost.inject.globalSettings({
    devices: {
      "RINCON_LIVINGROOMBAR01400": {
        uuid: "RINCON_LIVINGROOMBAR01400",
        zoneName: "Living Room",
        hostAddress: "192.168.1.10",
        port: 1400,
        isSatellite: false,
        idleState: "ACTIVE",
        primary: true
      },
      "RINCON_LIVINGROOMSUB01400": {
        uuid: "RINCON_LIVINGROOMSUB01400",
        zoneName: "Living Room",
        hostAddress: "192.168.1.11",
        port: 1400,
        isSatellite: true,
        idleState: "ACTIVE",
        primary: false
      },
      "RINCON_LIVINGROOMSURROUNDLEFT01400": {
        uuid: "RINCON_LIVINGROOMSURROUNDLEFT01400",
        zoneName: "Living Room",
        hostAddress: "192.168.1.12",
        port: 1400,
        isSatellite: true,
        idleState: "ACTIVE",
        primary: false
      },
      "RINCON_LIVINGROOMSURROUNDRIGHT01400": {
        uuid: "RINCON_LIVINGROOMSURROUNDRIGHT01400",
        zoneName: "Living Room",
        hostAddress: "192.168.1.13",
        port: 1400,
        isSatellite: true,
        idleState: "ACTIVE",
        primary: false
      },
      "RINCON_BEDROOM01400": {
        uuid: "RINCON_BEDROOM01400",
        zoneName: "Bedroom",
        hostAddress: "192.168.1.20",
        port: 1400,
        isSatellite: false,
        idleState: "ACTIVE",
        primary: false
      },
      "RINCON_OFFICE01400": {
        uuid: "RINCON_OFFICE01400",
        zoneName: "Office",
        hostAddress: "192.168.1.30",
        port: 1400,
        isSatellite: false,
        idleState: "ACTIVE",
        primary: false
      }
    },
    deviceCheckInterval: 10,
    deviceTimeoutDuration: 10,
    adjustVolumeIncrement: 10,
    favorites: []
  });

  await expandAccordion(page, "#sonos-speakers-accordeon");

  const picker = page.locator("[data-pi-speaker-picker]");
  await expect(picker.locator("option")).toHaveCount(6);

  const filter = page.locator("[data-pi-speaker-filter]");
  await filter.fill("bedroom");
  await expect(picker.locator("option")).toHaveCount(1);
  await expect(picker.locator("option")).toHaveText("Bedroom (192.168.1.20)");

  await filter.fill("livingroomsub");
  await expect(picker.locator("option")).toHaveCount(1);
  await expect(picker.locator("option")).toHaveText("Living Room (192.168.1.11) 🛰️");

  await filter.fill("");
  await expect(picker.locator("option")).toHaveCount(6);
});

test("p4-volume-override-1", async ({ page }) => {
  await installMockSonos(page, {
    topologyFixture: "zonegroupstate-multi-group.xml"
  });

  await page.addInitScript(mockStreamDeckHostSource);
  await page.goto("/pi.html");
  const mockHost = createMockHost(page);
  await mockHost.clearOutbound();

  await connect(page, {
    uuid: "pi-uuid-p4",
    registerEvent: "registerPropertyInspector",
    actionInfo: {
      action: "com.r-teller.sonoscontroller.volume-up",
      context: "ctx-p4",
      payload: { settings: {}, controller: "Keypad" }
    }
  });

  const volInput = page.locator("[data-pi-volume-increment-override]");
  await expect(volInput).toHaveAttribute("placeholder", "Global default: 10");

  await mockHost.clearOutbound();
  await volInput.fill("1");

  await expect.poll(async () => (await mockHost.outbound("setSettings")).length).toBe(1);
  const setSettingsFrames = await mockHost.outbound("setSettings");
  expect(setSettingsFrames).toHaveLength(1);
  expect(setSettingsFrames[0].payload.adjustVolumeIncrement).toBe(1);

  await mockHost.clearOutbound();
  await volInput.fill("");

  await expect.poll(async () => (await mockHost.outbound("setSettings")).length).toBe(1);
  const setSettingsFrames2 = await mockHost.outbound("setSettings");
  expect(setSettingsFrames2).toHaveLength(1);
  expect(setSettingsFrames2[0].payload.adjustVolumeIncrement).toBeNull();
});

test("p4-favorites", async ({ page }, testInfo) => {
  test.setTimeout(30_000);
  const mock = await installMockSonos(page, {
    topologyFixture: "zonegroupstate-multi-group.xml",
    favoritesFixture: "browse-fv2-mixed.xml"
  });

  await page.addInitScript(mockStreamDeckHostSource);
  await page.goto("/pi.html");
  const mockHost = createMockHost(page);
  await mockHost.clearOutbound();

  await connect(page, {
    uuid: "pi-uuid-p4",
    registerEvent: "registerPropertyInspector",
    actionInfo: {
      action: "com.r-teller.sonoscontroller.play-sonos-favorite",
      context: "ctx-p4",
      payload: { settings: {}, controller: "Keypad" }
    }
  });

  const addressInput = page.locator("[data-pi-primary-device-address]");
  await addressInput.fill("192.168.1.42");
  const saveButton = page.locator("[data-pi-save-and-connect]");
  await saveButton.click();

  await expect(saveButton).toHaveText("Save and Reconnect", { timeout: 15_000 });

  const favSelect = page.locator("[data-pi-favorite-select]");
  await expect(favSelect.locator("option")).toHaveCount(12);

  const optionTexts = (await favSelect.locator("option").allTextContents()).map((t) => t.trim());
  expect(optionTexts).toContain("BBC Radio 1");
  expect(optionTexts).toContain("Lana Del Rey — Did You Know That There's a Tunnel Under Ocean Blvd");
  expect(optionTexts).toContain("Café Tacuba — Re");

  await mockHost.clearOutbound();
  await favSelect.selectOption({ label: "Café Tacuba — Re" });

  await expect.poll(async () => (await mockHost.outbound("setSettings")).length).toBe(1);
  const setSettingsFrames = await mockHost.outbound("setSettings");
  expect(setSettingsFrames).toHaveLength(1);
  const payload = setSettingsFrames[0].payload;
  expect(payload.selectedSonosFavorite.title).toBe("Café Tacuba — Re");
  expect(payload.selectedSonosFavorite.uri).toBeDefined();
  expect(payload.selectedSonosFavorite.uri).not.toBe("");
  expect(payload.selectedSonosFavorite.metadata).toMatch(/^<DIDL-Lite/);
});

test("p4-reopen", async ({ page }) => {
  const mock = await installMockSonos(page, {
    topologyFixture: "zonegroupstate-multi-group.xml"
  });

  await page.addInitScript(mockStreamDeckHostSource);
  await page.goto("/pi.html");
  const mockHost = createMockHost(page);
  await mockHost.clearOutbound();

  await connect(page, {
    uuid: "pi-uuid-p4",
    registerEvent: "registerPropertyInspector",
    actionInfo: {
      action: "com.r-teller.sonoscontroller.volume-up",
      context: "ctx-p4",
      payload: {
        settings: {
          uuid: "RINCON_OFFICE01400",
          title: "Office (192.168.1.42)",
          hostAddress: "192.168.1.42",
          zoneName: "Office"
        },
        controller: "Keypad"
      }
    }
  });

  await mockHost.inject.globalSettings({
    devices: {
      "RINCON_OFFICE01400": {
        uuid: "RINCON_OFFICE01400",
        zoneName: "Office",
        hostAddress: "192.168.1.42",
        port: 1400,
        isSatellite: false,
        idleState: "ACTIVE",
        primary: true
      },
      "RINCON_KITCHEN01400": {
        uuid: "RINCON_KITCHEN01400",
        zoneName: "Kitchen",
        hostAddress: "192.168.1.43",
        port: 1400,
        isSatellite: false,
        idleState: "ACTIVE",
        primary: false
      },
      "RINCON_DININGROOM01400": {
        uuid: "RINCON_DININGROOM01400",
        zoneName: "Dining Room",
        hostAddress: "192.168.1.44",
        port: 1400,
        isSatellite: false,
        idleState: "ACTIVE",
        primary: false
      },
      "RINCON_PATIO01400": {
        uuid: "RINCON_PATIO01400",
        zoneName: "Patio",
        hostAddress: "192.168.1.45",
        port: 1400,
        isSatellite: false,
        idleState: "ACTIVE",
        primary: false
      }
    },
    deviceCheckInterval: 10,
    deviceTimeoutDuration: 10,
    adjustVolumeIncrement: 10,
    favorites: [
      {
        title: "Test Favorite",
        uri: "x-rincon:RINCON_OFFICE01400",
        metadata: "<DIDL-Lite></DIDL-Lite>"
      }
    ]
  });

  const saveButton = page.locator("[data-pi-save-and-connect]");
  await expect(saveButton).toHaveText("Save and Reconnect");

  const addressInput = page.locator("[data-pi-primary-device-address]");
  await expect(addressInput).toHaveValue("192.168.1.42");

  const picker = page.locator("[data-pi-speaker-picker]");
  await expect(picker.locator("option")).toHaveCount(4);

  const boundAlert = page.locator("[data-pi-bound-speaker-alert]");
  await expect(boundAlert).toBeVisible();
  await expect(boundAlert).toContainText("Office (192.168.1.42)");

  expect(mock.calls.length).toBe(0);
});

test("p4-keyboard-a11y", async ({ page }) => {
  await installMockSonos(page, {
    topologyFixture: "zonegroupstate-multi-group.xml"
  });

  await page.addInitScript(mockStreamDeckHostSource);
  await page.goto("/pi.html");
  const mockHost = createMockHost(page);
  await mockHost.clearOutbound();

  await connect(page, {
    uuid: "pi-uuid-p4",
    registerEvent: "registerPropertyInspector",
    actionInfo: {
      action: "com.r-teller.sonoscontroller.volume-up",
      context: "ctx-p4",
      payload: { settings: {}, controller: "Keypad" }
    }
  });

  const globalAccordionHeader = page.locator("#global-settings-accordeon .accordion-button");
  await expect(globalAccordionHeader).toHaveAttribute("aria-expanded", "true");

  await globalAccordionHeader.focus();
  await page.keyboard.press("Enter");
  await expect(globalAccordionHeader).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#global-settings-accordeon .accordion-collapse")).not.toHaveClass(/show|collapsing/);

  await page.keyboard.press("Enter");
  await expect(globalAccordionHeader).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#global-settings-accordeon .accordion-collapse")).toHaveClass(/(?:^|\s)show(?:\s|$)/);
  await expect(page.locator("#global-settings-accordeon .accordion-collapse")).not.toHaveClass(/collapsing/);

  const addressInput = page.locator("[data-pi-primary-device-address]");
  await addressInput.focus();
  await addressInput.fill("1.2.3.4");

  const timeoutInput = page.locator("[data-pi-device-timeout-duration]");
  const checkIntervalInput = page.locator("[data-pi-device-check-interval]");
  const volumeIncrementInput = page.locator("[data-pi-global-volume-increment]");
  const saveButton = page.locator("[data-pi-save-and-connect]");

  await page.keyboard.press("Tab");
  await expect(timeoutInput).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(checkIntervalInput).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(volumeIncrementInput).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(saveButton).toBeFocused();

  const volOverrideInput = page.locator("[data-pi-volume-increment-override]");
  await volOverrideInput.focus();
  await expect(volOverrideInput).toBeFocused();

  const stateBasedTitleToggle = page.locator("[data-pi-toggle-state-based-title]");
  await stateBasedTitleToggle.focus();
  await expect(stateBasedTitleToggle).toBeFocused();
});
