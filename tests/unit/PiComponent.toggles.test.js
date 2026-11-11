// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

vi.mock("@/modules/common/sdConnect.js", () => ({
  streamDeckReady: new Promise(() => {}),
  installStreamDeckBridge: vi.fn(),
  getStreamDeckClient: vi.fn(() => null),
}));
vi.mock("bootstrap", () => ({
  Collapse: class {
    constructor() {
      this.show = vi.fn();
      this.hide = vi.fn();
      this.dispose = vi.fn();
    }
  },
}));

import PiComponent from "@/components/PiComponent.vue";

function createStubClient() {
  const handlers = {};
  return {
    saveSettings: vi.fn(),
    saveGlobalSettings: vi.fn(),
    requestGlobalSettings: vi.fn(),
    uuid: "pi-ctx",
    connected: true,
    actionInfo: {
      action: "com.r-teller.sonoscontroller.volume-up",
      payload: {
        controller: "Keypad",
        settings: {},
      },
    },
    on: (event, cb) => {
      handlers[event] = cb;
    },
    __handlers: handlers,
  };
}

/**
 * Mount PiComponent with a stub client, set actionUUID and settings, then await nextTick.
 * @param {string} shortName
 * @param {object} settings
 * @returns {object} wrapper
 */
async function mountForAction(shortName, settings = {}) {
  const wrapper = mount(PiComponent);
  const stubClient = createStubClient();
  wrapper.vm.sdClient = stubClient;
  wrapper.vm.actionUUID = `com.r-teller.sonoscontroller.${shortName}`;
  wrapper.vm.settings = settings;
  // ensure globalSettings stays empty to avoid default-bind watcher side‑effects
  wrapper.vm.globalSettings = {};
  await nextTick();
  return { wrapper, stubClient };
}

describe("PiComponent presentation toggles", () => {
  const visibilityCases = [
    {
      shortName: "toggle-play-mode",
      toggles: {
        stateBased: true,
        marquee: false,
        marqueeAlbum: false,
        albumArt: false,
      },
      section: true,
    },
    {
      shortName: "toggle-input-source",
      toggles: {
        stateBased: true,
        marquee: false,
        marqueeAlbum: false,
        albumArt: false,
      },
      section: true,
    },
    {
      shortName: "toggle-play-pause",
      toggles: {
        stateBased: true,
        marquee: false,
        marqueeAlbum: true,
        albumArt: true,
      },
      section: true,
    },
    {
      shortName: "toggle-mute-unmute",
      toggles: {
        stateBased: true,
        marquee: false,
        marqueeAlbum: false,
        albumArt: false,
      },
      section: true,
    },
    {
      shortName: "volume-up",
      toggles: {
        stateBased: true,
        marquee: false,
        marqueeAlbum: false,
        albumArt: false,
      },
      section: true,
    },
    {
      shortName: "volume-down",
      toggles: {
        stateBased: true,
        marquee: false,
        marqueeAlbum: false,
        albumArt: false,
      },
      section: true,
    },
    {
      shortName: "play-previous-track",
      toggles: {
        stateBased: true,
        marquee: false,
        marqueeAlbum: false,
        albumArt: false,
      },
      section: true,
    },
    {
      shortName: "play-next-track",
      toggles: {
        stateBased: true,
        marquee: false,
        marqueeAlbum: false,
        albumArt: false,
      },
      section: true,
    },
    {
      shortName: "play-sonos-favorite",
      // Favorite keys use their own five toggles (sonos-gw5); the legacy ones are hidden.
      toggles: {
        stateBased: false,
        marquee: false,
        marqueeAlbum: false,
        albumArt: false,
      },
      section: true,
    },
    {
      shortName: "currently-playing",
      toggles: {
        stateBased: false,
        marquee: true,
        marqueeAlbum: true,
        albumArt: true,
      },
      section: true,
    },
    {
      shortName: "encoder-audio-equalizer",
      toggles: {
        stateBased: false,
        marquee: false,
        marqueeAlbum: false,
        albumArt: false,
      },
      section: false,
    },
  ];

  it("Visibility matrix", async () => {
    for (const c of visibilityCases) {
      const { wrapper } = await mountForAction(c.shortName);
      const sectionExists = wrapper.find('[data-pi-section="presentation-toggles"]').exists();
      expect(sectionExists).toBe(c.section);
      const stateBasedExists = wrapper.find("[data-pi-toggle-state-based-title]").exists();
      const marqueeExists = wrapper.find("[data-pi-toggle-marquee-title]").exists();
      const marqueeAlbumExists = wrapper.find("[data-pi-toggle-marquee-album-title]").exists();
      const albumArtExists = wrapper.find("[data-pi-toggle-album-art]").exists();
      expect(stateBasedExists).toBe(c.toggles.stateBased);
      expect(marqueeExists).toBe(c.toggles.marquee);
      expect(marqueeAlbumExists).toBe(c.toggles.marqueeAlbum);
      expect(albumArtExists).toBe(c.toggles.albumArt);
    }
  });

  it("Toggle on saves full 24-field payload", async () => {
    const { wrapper, stubClient } = await mountForAction("toggle-play-pause");
    const albumArtToggle = wrapper.find("[data-pi-toggle-album-art]");
    await albumArtToggle.setValue(true);
    expect(stubClient.saveSettings).toHaveBeenCalledTimes(1);
    const payload = stubClient.saveSettings.mock.calls[0][0].actionSettings;
    // Expect exactly 23 keys (the schema includes many fields; we assert length)
    expect(Object.keys(payload).length).toBe(24);
    expect(payload.displayAlbumArt).toBe(true);
    expect(payload.action).toBe("com.r-teller.sonoscontroller.toggle-play-pause");
    // other applicable toggles should be false
    expect(payload.displayStateBasedTitle).toBe(false);
    expect(payload.displayMarqueeAlbumTitle).toBe(false);
  });

  it("Display Track Time (sonos-bg0.2): on by default, needs album art, saves false when turned off", async () => {
    const { wrapper, stubClient } = await mountForAction("currently-playing", { displayAlbumArt: true });
    const toggle = wrapper.find("[data-pi-toggle-track-time]");
    expect(toggle.exists()).toBe(true);
    expect(toggle.element.checked).toBe(true);
    expect(toggle.element.disabled).toBe(false);
    await toggle.setValue(false);
    expect(stubClient.saveSettings.mock.calls[0][0].actionSettings.displayTrackTime).toBe(false);

    const noArt = await mountForAction("toggle-play-pause", { displayAlbumArt: false });
    expect(noArt.wrapper.find("[data-pi-toggle-track-time]").element.disabled).toBe(true);
    const other = await mountForAction("toggle-mute-unmute", {});
    expect(other.wrapper.find("[data-pi-toggle-track-time]").exists()).toBe(false);
  });

  it("Toggle off persists false, not null", async () => {
    const { wrapper, stubClient } = await mountForAction("currently-playing", {
      displayMarqueeTitle: true,
    });
    const marqueeToggle = wrapper.find("[data-pi-toggle-marquee-title]");
    await marqueeToggle.setValue(false);
    expect(stubClient.saveSettings).toHaveBeenCalledTimes(1);
    const payload = stubClient.saveSettings.mock.calls[0][0].actionSettings;
    expect(payload.displayMarqueeTitle).toBe(false);
    // non‑applicable field should be null
    expect(payload.displayStateBasedTitle).toBeNull();
  });

  it("Changed-field-only diff", async () => {
    const { wrapper, stubClient } = await mountForAction("currently-playing", {});
    const baseline = wrapper.vm.buildSaveInput({});
    const albumArtToggle = wrapper.find("[data-pi-toggle-album-art]");
    await albumArtToggle.setValue(true);
    expect(stubClient.saveSettings).toHaveBeenCalledTimes(1);
    const savedPayload = stubClient.saveSettings.mock.calls[0][0].actionSettings;
    const expected = { ...baseline, displayAlbumArt: true };
    expect(savedPayload).toEqual(expected);
  });

  it("Checked state reads with ?? false", async () => {
    // unchecked case
    const { wrapper: w1 } = await mountForAction("volume-up", {});
    const toggle1 = w1.find("[data-pi-toggle-state-based-title]").element;
    expect(toggle1.checked).toBe(false);
    // checked case
    const { wrapper: w2 } = await mountForAction("volume-up", {
      displayStateBasedTitle: true,
    });
    const toggle2 = w2.find("[data-pi-toggle-state-based-title]").element;
    expect(toggle2.checked).toBe(true);
  });

  it("Favorite key shows the five favorite toggles and migrates legacy settings", async () => {
    // Connect the way Stream Deck does, with settings saved by the old version of the plugin.
    const wrapper = mount(PiComponent);
    const stubClient = createStubClient();
    stubClient.actionInfo = {
      action: "com.r-teller.sonoscontroller.play-sonos-favorite",
      payload: { controller: "Keypad", settings: { displayAlbumArt: true, displayMarqueeTitle: false } },
    };
    wrapper.vm.bindStreamDeck(stubClient);
    await nextTick();
    const keys = wrapper.findAll("[data-pi-favorite-toggle]").map((w) => w.attributes("data-pi-favorite-toggle"));
    expect(keys).toEqual([
      "displayFavoriteName",
      "displayTrackTitle",
      "displayMarquee",
      "displayFavoriteArtwork",
      "displayTrackArtwork",
    ]);
    const checked = (k) => wrapper.find(`[data-pi-favorite-toggle="${k}"]`).element.checked;
    expect(checked("displayFavoriteName")).toBe(true);
    expect(checked("displayFavoriteArtwork")).toBe(true);
    expect(checked("displayTrackArtwork")).toBe(true);
    expect(checked("displayTrackTitle")).toBe(false);
    // Marquee needs the track title
    expect(wrapper.find('[data-pi-favorite-toggle="displayMarquee"]').element.disabled).toBe(true);

    await wrapper.find('[data-pi-favorite-toggle="displayTrackTitle"]').setValue(true);
    const payload = stubClient.saveSettings.mock.lastCall[0].actionSettings;
    expect(payload.displayTrackTitle).toBe(true);
    expect(payload.displayFavoriteArtwork).toBe(true);
    expect(payload.displayAlbumArt).toBeNull();
    expect(payload.displayMarqueeTitle).toBeNull();
    expect(wrapper.find('[data-pi-favorite-toggle="displayMarquee"]').element.disabled).toBe(false);
  });
});
