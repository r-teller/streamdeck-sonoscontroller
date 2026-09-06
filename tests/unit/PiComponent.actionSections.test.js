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

const FAVORITES = [
  {
    title: "Jazz Café",
    uri: "x-rincon-cpcontainer:1006206cjazz",
    metadata: '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item>Jazz Café</item></DIDL-Lite>',
    albumArtURI: "http://art/jazz.jpg",
  },
  {
    title: "Røck",
    uri: "x-rincon-cpcontainer:1006206crock",
    metadata: "<DIDL-Lite><item>Røck</item></DIDL-Lite>",
    albumArtURI: "http://art/rock.jpg",
  },
];

const b64 = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

async function mountForAction(shortName, settings = {}, globalSettings = undefined) {
  const wrapper = mount(PiComponent);
  const stub = createStubClient();
  wrapper.vm.sdClient = stub;
  wrapper.vm.actionUUID = `com.r-teller.sonoscontroller.${shortName}`;
  wrapper.vm.settings = settings;
  if (globalSettings !== undefined) {
    wrapper.vm.globalSettings = globalSettings;
  }
  await nextTick();
  await nextTick();
  return { wrapper, stub };
}

function getLastSaved(stub) {
  const calls = stub.saveSettings.mock.calls;
  if (calls.length === 0) return null;
  return calls[calls.length - 1][0].actionSettings;
}

describe("PiComponent action sections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mutual exclusivity of sections", async () => {
    const actions = ["toggle-play-mode", "toggle-input-source", "encoder-audio-equalizer", "play-sonos-favorite", "volume-up"];
    const expected = {
      "toggle-play-mode": "play-modes",
      "toggle-input-source": "input-sources",
      "encoder-audio-equalizer": "equalizer-target",
      "play-sonos-favorite": "sonos-favorites",
      "volume-up": null,
    };
    for (const short of actions) {
      const { wrapper } = await mountForAction(short);
      const sections = ["play-modes", "input-sources", "equalizer-target", "sonos-favorites"];
      for (const sec of sections) {
        const exists = wrapper.find(`[data-pi-section="${sec}"]`).exists();
        if (expected[short] === sec) {
          expect(exists).toBe(true);
        } else {
          expect(exists).toBe(false);
        }
      }
    }
  });

  it("play modes render in canonical order, all checked by default", async () => {
    const { wrapper } = await mountForAction("toggle-play-mode", {});
    const switches = wrapper.findAll("[data-pi-play-mode]");
    const attrs = switches.map((el) => el.attributes("data-pi-play-mode"));
    expect(attrs).toEqual(["NORMAL", "SHUFFLE_NOREPEAT", "SHUFFLE_REPEAT_ONE", "SHUFFLE", "REPEAT_ONE", "REPEAT_ALL"]);
    for (const el of switches) {
      expect(el.element.checked).toBe(true);
    }
  });

  it("play-mode toggle re-sorts to canonical order", async () => {
    // non-canonical initial order, then enable SHUFFLE
    const { wrapper, stub } = await mountForAction("toggle-play-mode", {
      selectedPlayModes: ["REPEAT_ALL", "NORMAL"],
    });
    const shuffleSwitch = wrapper.find('[data-pi-play-mode="SHUFFLE"]');
    await shuffleSwitch.setValue(true);
    await nextTick();
    const saved = getLastSaved(stub);
    expect(saved.selectedPlayModes).toEqual(["NORMAL", "SHUFFLE", "REPEAT_ALL"]);

    // turn OFF NORMAL from default-all
    const { wrapper: w2, stub: s2 } = await mountForAction("toggle-play-mode", {});
    const normalSwitch = w2.find('[data-pi-play-mode="NORMAL"]');
    await normalSwitch.setValue(false);
    await nextTick();
    const saved2 = getLastSaved(s2);
    expect(saved2.selectedPlayModes).toEqual(["SHUFFLE_NOREPEAT", "SHUFFLE_REPEAT_ONE", "SHUFFLE", "REPEAT_ONE", "REPEAT_ALL"]);
  });

  it("input sources render and toggle", async () => {
    const { wrapper, stub } = await mountForAction("toggle-input-source", {});
    const switches = wrapper.findAll("[data-pi-input-source]");
    const attrs = switches.map((el) => el.attributes("data-pi-input-source"));
    expect(attrs).toEqual(["Sonos_Queue", "TV_Input", "Line_In"]);
    const sectionText = wrapper.find('[data-pi-section="input-sources"]').text();
    expect(sectionText).toContain("Sonos Queue");
    expect(sectionText).toContain("Tv Input");
    expect(sectionText).toContain("Line In");

    const tvSwitch = wrapper.find('[data-pi-input-source="TV_Input"]');
    await tvSwitch.setValue(false);
    await nextTick();
    const saved = getLastSaved(stub);
    expect(saved.selectedInputSources).toEqual(["Sonos_Queue", "Line_In"]);
  });

  it("equalizer target default and change", async () => {
    const { wrapper, stub } = await mountForAction("encoder-audio-equalizer", {});
    const select = wrapper.find("[data-pi-eq-target-select]");
    expect(select.element.value).toBe("VOLUME");
    await select.setValue("BASS");
    await nextTick();
    const saved = getLastSaved(stub);
    expect(saved.encoderAudioEqualizerTarget).toBe("BASS");
    expect(saved.selectedPlayModes).toBeNull();
  });

  it("favorites options render correctly", async () => {
    const { wrapper } = await mountForAction("play-sonos-favorite", {}, { favorites: FAVORITES });
    const select = wrapper.find("[data-pi-favorite-select]");
    const options = select.findAll("option");
    expect(options).toHaveLength(2);
    expect(select.element.value).toBe(FAVORITES[0].uri);
    options.forEach((opt, idx) => {
      const fav = FAVORITES[idx];
      expect(opt.attributes("value")).toBe(fav.uri);
      expect(opt.text()).toBe(fav.title);
      expect(opt.attributes("data-metadata")).toBe(b64(fav.metadata));
    });
  });

  it("stored favorite overrides first option", async () => {
    const { wrapper } = await mountForAction(
      "play-sonos-favorite",
      { selectedSonosFavorite: FAVORITES[1] },
      { favorites: FAVORITES },
    );
    const select = wrapper.find("[data-pi-favorite-select]");
    expect(select.element.value).toBe(FAVORITES[1].uri);
  });

  it("selection persists full decoded favorite record", async () => {
    const { wrapper, stub } = await mountForAction("play-sonos-favorite", {}, { favorites: FAVORITES });
    const select = wrapper.find("[data-pi-favorite-select]");
    await select.setValue(FAVORITES[1].uri);
    await nextTick();
    const saved = getLastSaved(stub);
    expect(saved.selectedSonosFavorite).toEqual({
      title: FAVORITES[1].title,
      uri: FAVORITES[1].uri,
      metadata: FAVORITES[1].metadata,
      albumArtURI: FAVORITES[1].albumArtURI,
    });
  });
});
