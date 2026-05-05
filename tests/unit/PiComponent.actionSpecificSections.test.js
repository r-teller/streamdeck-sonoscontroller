// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

vi.mock("@/modules/common/sdConnect.js", () => ({
  streamDeckReady: new Promise(() => {}),
  installStreamDeckBridge: vi.fn(),
  getStreamDeckClient: vi.fn(() => null),
}));

import PiComponent from "@/components/PiComponent.vue";

const PREFIX = "com.r-teller.sonoscontroller.";

function makeMockSd() {
  return {
    uuid: "context-abc",
    actionInfo: { action: "", controller: "Keypad", states: [] },
    saveSettings: vi.fn(),
    saveGlobalSettings: vi.fn(),
  };
}

async function mountForAction(actionShortName, opts = {}) {
  const mockSd = makeMockSd();
  const wrapper = mount(PiComponent);
  wrapper.vm.sdClient = mockSd;
  wrapper.vm.actionUUID = PREFIX + actionShortName;
  if (opts.globalSettings) wrapper.vm.globalSettings = opts.globalSettings;
  if (opts.settings) wrapper.vm.settings = opts.settings;
  await nextTick();
  return { wrapper, mockSd };
}

// ────────────────────────────────────────────────────────────────────────────
// Cross-section: only one of the four sections renders at a time
// ────────────────────────────────────────────────────────────────────────────

describe("PiComponent — conditional sections (orw.6 visibility matrix)", () => {
  const sectionSelectors = [
    '[data-pi-section="play-modes"]',
    '[data-pi-section="input-sources"]',
    '[data-pi-section="equalizer-target"]',
    '[data-pi-section="sonos-favorites"]',
  ];

  it("toggle-play-mode → only Play Mode(s) renders", async () => {
    const { wrapper } = await mountForAction("toggle-play-mode");
    expect(wrapper.find('[data-pi-section="play-modes"]').exists()).toBe(true);
    expect(wrapper.find('[data-pi-section="input-sources"]').exists()).toBe(
      false,
    );
    expect(
      wrapper.find('[data-pi-section="equalizer-target"]').exists(),
    ).toBe(false);
    expect(
      wrapper.find('[data-pi-section="sonos-favorites"]').exists(),
    ).toBe(false);
  });

  it("toggle-input-source → only Input Source(s) renders", async () => {
    const { wrapper } = await mountForAction("toggle-input-source");
    expect(wrapper.find('[data-pi-section="input-sources"]').exists()).toBe(
      true,
    );
    expect(wrapper.find('[data-pi-section="play-modes"]').exists()).toBe(false);
  });

  it("encoder-audio-equalizer → only Equalizer Target renders", async () => {
    const { wrapper } = await mountForAction("encoder-audio-equalizer");
    expect(
      wrapper.find('[data-pi-section="equalizer-target"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-pi-section="play-modes"]').exists()).toBe(false);
  });

  it("play-sonos-favorite → only Sonos Favorite(s) renders", async () => {
    const { wrapper } = await mountForAction("play-sonos-favorite");
    expect(
      wrapper.find('[data-pi-section="sonos-favorites"]').exists(),
    ).toBe(true);
    expect(wrapper.find('[data-pi-section="play-modes"]').exists()).toBe(false);
  });

  it("toggle-mute-unmute → none of the four sections render", async () => {
    const { wrapper } = await mountForAction("toggle-mute-unmute");
    for (const sel of sectionSelectors) {
      expect(wrapper.find(sel).exists()).toBe(false);
    }
  });

  it("volume-up → none of the four sections render", async () => {
    const { wrapper } = await mountForAction("volume-up");
    for (const sel of sectionSelectors) {
      expect(wrapper.find(sel).exists()).toBe(false);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Play Mode(s)
// ────────────────────────────────────────────────────────────────────────────

describe("PiComponent — Play Mode(s) section (orw.6 AC)", () => {
  it("AC: heading is `Play Mode(s)` verbatim", async () => {
    const { wrapper } = await mountForAction("toggle-play-mode");
    expect(wrapper.find('[data-pi-section="play-modes"] h1').text()).toBe(
      "Play Mode(s)",
    );
  });

  it("AC: renders six switches in canonical order", async () => {
    const { wrapper } = await mountForAction("toggle-play-mode");
    const switches = wrapper.findAll("[data-pi-play-mode]");
    expect(switches.map((s) => s.attributes("data-pi-play-mode"))).toEqual([
      "NORMAL",
      "SHUFFLE_NOREPEAT",
      "SHUFFLE_REPEAT_ONE",
      "SHUFFLE",
      "REPEAT_ONE",
      "REPEAT_ALL",
    ]);
  });

  it("AC: labels are formatted exactly per spec", async () => {
    const { wrapper } = await mountForAction("toggle-play-mode");
    const labels = wrapper
      .findAll("[data-pi-play-mode] label")
      .map((l) => l.text());
    expect(labels).toEqual([
      "Normal",
      "Shuffle No Repeat",
      "Shuffle Repeat One",
      "Shuffle",
      "Repeat One",
      "Repeat All",
    ]);
  });

  it("AC: all six switches default to checked", async () => {
    const { wrapper } = await mountForAction("toggle-play-mode");
    const checked = wrapper
      .findAll("[data-pi-play-mode] input")
      .map((i) => i.element.checked);
    expect(checked).toEqual([true, true, true, true, true, true]);
  });

  it("AC: unchecking REPEAT_ONE persists subset without it (canonical order preserved)", async () => {
    const { wrapper, mockSd } = await mountForAction("toggle-play-mode");
    await wrapper
      .find('[data-pi-play-mode="REPEAT_ONE"] input')
      .setValue(false);
    const persisted =
      mockSd.saveSettings.mock.calls.at(-1)[0].actionSettings;
    expect(persisted.selectedPlayModes).toEqual([
      "NORMAL",
      "SHUFFLE_NOREPEAT",
      "SHUFFLE_REPEAT_ONE",
      "SHUFFLE",
      "REPEAT_ALL",
    ]);
  });

  it("checkbox state reflects persisted selectedPlayModes subset", async () => {
    const { wrapper } = await mountForAction("toggle-play-mode", {
      settings: {
        action: PREFIX + "toggle-play-mode",
        selectedPlayModes: ["NORMAL", "SHUFFLE"],
      },
    });
    expect(
      wrapper.find('[data-pi-play-mode="NORMAL"] input').element.checked,
    ).toBe(true);
    expect(
      wrapper.find('[data-pi-play-mode="SHUFFLE"] input').element.checked,
    ).toBe(true);
    expect(
      wrapper.find('[data-pi-play-mode="REPEAT_ONE"] input').element.checked,
    ).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Input Source(s)
// ────────────────────────────────────────────────────────────────────────────

describe("PiComponent — Input Source(s) section (orw.6 AC)", () => {
  it("AC: heading `Input Source(s)` verbatim", async () => {
    const { wrapper } = await mountForAction("toggle-input-source");
    expect(wrapper.find('[data-pi-section="input-sources"] h1').text()).toBe(
      "Input Source(s)",
    );
  });

  it("AC: renders three switches with verbatim labels (with internal spaces, NOT underscores)", async () => {
    const { wrapper } = await mountForAction("toggle-input-source");
    const labels = wrapper
      .findAll("[data-pi-input-source] label")
      .map((l) => l.text());
    expect(labels).toEqual(["Sonos Queue", "Tv Input", "Line In"]);
  });

  it("AC: all three switches default to checked", async () => {
    const { wrapper } = await mountForAction("toggle-input-source");
    const checked = wrapper
      .findAll("[data-pi-input-source] input")
      .map((i) => i.element.checked);
    expect(checked).toEqual([true, true, true]);
  });

  it("AC: persisted source names use underscores (matches state names)", async () => {
    const { wrapper, mockSd } = await mountForAction("toggle-input-source");
    await wrapper
      .find('[data-pi-input-source="TV_Input"] input')
      .setValue(false);
    const persisted =
      mockSd.saveSettings.mock.calls.at(-1)[0].actionSettings;
    expect(persisted.selectedInputSources).toEqual(["Sonos_Queue", "Line_In"]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Equalizer Target
// ────────────────────────────────────────────────────────────────────────────

describe("PiComponent — Equalizer Target section (orw.6 AC)", () => {
  it("AC: heading `Equalizer Target` verbatim", async () => {
    const { wrapper } = await mountForAction("encoder-audio-equalizer");
    expect(
      wrapper.find('[data-pi-section="equalizer-target"] h1').text(),
    ).toBe("Equalizer Target");
  });

  it("AC: dropdown offers exactly Volume / Bass / Treble", async () => {
    const { wrapper } = await mountForAction("encoder-audio-equalizer");
    const labels = wrapper
      .findAll("[data-pi-eq-target-select] option")
      .map((o) => o.text());
    expect(labels).toEqual(["Volume", "Bass", "Treble"]);
  });

  it("AC: default selection is Volume", async () => {
    const { wrapper } = await mountForAction("encoder-audio-equalizer");
    expect(wrapper.find("[data-pi-eq-target-select]").element.value).toBe(
      "VOLUME",
    );
  });

  it("AC: persists VOLUME / BASS / TREBLE on change", async () => {
    const { wrapper, mockSd } = await mountForAction(
      "encoder-audio-equalizer",
    );
    await wrapper.find("[data-pi-eq-target-select]").setValue("BASS");
    const persisted =
      mockSd.saveSettings.mock.calls.at(-1)[0].actionSettings;
    expect(persisted.encoderAudioEqualizerTarget).toBe("BASS");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Sonos Favorite(s)
// ────────────────────────────────────────────────────────────────────────────

describe("PiComponent — Sonos Favorite(s) section (orw.6 AC)", () => {
  const FAVORITES = [
    {
      title: "Morning Mix",
      uri: "x-rincon-cpcontainer:morning",
      metadata: '<DIDL-Lite><item id="1"/></DIDL-Lite>',
      albumArtURI: "/morning.jpg",
    },
    {
      title: "Workout Beats",
      uri: "x-rincon-cpcontainer:workout",
      metadata: '<DIDL-Lite><item id="2"/></DIDL-Lite>',
      albumArtURI: "/workout.jpg",
    },
  ];

  it("AC: heading `Sonos Favorite(s)` verbatim", async () => {
    const { wrapper } = await mountForAction("play-sonos-favorite", {
      globalSettings: { favorites: FAVORITES },
    });
    expect(wrapper.find('[data-pi-section="sonos-favorites"] h1').text()).toBe(
      "Sonos Favorite(s)",
    );
  });

  it("AC: dropdown lists each favorite by title", async () => {
    const { wrapper } = await mountForAction("play-sonos-favorite", {
      globalSettings: { favorites: FAVORITES },
    });
    const labels = wrapper
      .findAll("[data-pi-favorite-select] option")
      .map((o) => o.text());
    expect(labels).toEqual(["Morning Mix", "Workout Beats"]);
  });

  it("AC: default selection is the first favorite", async () => {
    const { wrapper } = await mountForAction("play-sonos-favorite", {
      globalSettings: { favorites: FAVORITES },
    });
    expect(wrapper.find("[data-pi-favorite-select]").element.value).toBe(
      "x-rincon-cpcontainer:morning",
    );
  });

  it("AC: selecting a favorite persists the full record", async () => {
    const { wrapper, mockSd } = await mountForAction("play-sonos-favorite", {
      globalSettings: { favorites: FAVORITES },
    });
    await wrapper
      .find("[data-pi-favorite-select]")
      .setValue("x-rincon-cpcontainer:workout");
    const persisted =
      mockSd.saveSettings.mock.calls.at(-1)[0].actionSettings;
    expect(persisted.selectedSonosFavorite).toEqual({
      title: "Workout Beats",
      uri: "x-rincon-cpcontainer:workout",
      metadata: '<DIDL-Lite><item id="2"/></DIDL-Lite>',
      albumArtURI: "/workout.jpg",
    });
  });

  it("renders empty dropdown when favorites array is empty", async () => {
    const { wrapper } = await mountForAction("play-sonos-favorite", {
      globalSettings: { favorites: [] },
    });
    expect(wrapper.findAll("[data-pi-favorite-select] option")).toHaveLength(
      0,
    );
  });
});
