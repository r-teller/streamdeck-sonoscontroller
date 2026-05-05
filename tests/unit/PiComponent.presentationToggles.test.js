// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
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

async function mountForAction(actionShortName) {
  const mockSd = makeMockSd();
  const wrapper = mount(PiComponent);
  wrapper.vm.sdClient = mockSd;
  wrapper.vm.actionUUID = PREFIX + actionShortName;
  await nextTick();
  return { wrapper, mockSd };
}

describe("PiComponent — presentation toggle visibility (orw.5 AC)", () => {
  it("AC: toggle-mute-unmute → only Display State Based Title visible", async () => {
    const { wrapper } = await mountForAction("toggle-mute-unmute");
    expect(wrapper.find("[data-pi-toggle-state-based-title]").exists()).toBe(
      true,
    );
    expect(wrapper.find("[data-pi-toggle-marquee-title]").exists()).toBe(false);
    expect(
      wrapper.find("[data-pi-toggle-marquee-album-title]").exists(),
    ).toBe(false);
    expect(wrapper.find("[data-pi-toggle-album-art]").exists()).toBe(false);
  });

  it("AC: currently-playing → Display Marquee Title, Display Marquee Album Title, Display Album Art visible (NOT State Based Title)", async () => {
    const { wrapper } = await mountForAction("currently-playing");
    expect(wrapper.find("[data-pi-toggle-state-based-title]").exists()).toBe(
      false,
    );
    expect(wrapper.find("[data-pi-toggle-marquee-title]").exists()).toBe(true);
    expect(
      wrapper.find("[data-pi-toggle-marquee-album-title]").exists(),
    ).toBe(true);
    expect(wrapper.find("[data-pi-toggle-album-art]").exists()).toBe(true);
  });

  it("AC: toggle-play-pause → State Based, Marquee Album Title, Album Art visible (NOT Marquee Title)", async () => {
    const { wrapper } = await mountForAction("toggle-play-pause");
    expect(wrapper.find("[data-pi-toggle-state-based-title]").exists()).toBe(
      true,
    );
    expect(wrapper.find("[data-pi-toggle-marquee-title]").exists()).toBe(false);
    expect(
      wrapper.find("[data-pi-toggle-marquee-album-title]").exists(),
    ).toBe(true);
    expect(wrapper.find("[data-pi-toggle-album-art]").exists()).toBe(true);
  });

  it("AC: play-sonos-favorite → Marquee Title, Album Art (NOT State Based, NOT Marquee Album Title)", async () => {
    const { wrapper } = await mountForAction("play-sonos-favorite");
    expect(wrapper.find("[data-pi-toggle-state-based-title]").exists()).toBe(
      false,
    );
    expect(wrapper.find("[data-pi-toggle-marquee-title]").exists()).toBe(true);
    expect(
      wrapper.find("[data-pi-toggle-marquee-album-title]").exists(),
    ).toBe(false);
    expect(wrapper.find("[data-pi-toggle-album-art]").exists()).toBe(true);
  });

  it("AC: encoder-audio-equalizer → none of the four switches visible", async () => {
    const { wrapper } = await mountForAction("encoder-audio-equalizer");
    expect(wrapper.find("[data-pi-toggle-state-based-title]").exists()).toBe(
      false,
    );
    expect(wrapper.find("[data-pi-toggle-marquee-title]").exists()).toBe(false);
    expect(
      wrapper.find("[data-pi-toggle-marquee-album-title]").exists(),
    ).toBe(false);
    expect(wrapper.find("[data-pi-toggle-album-art]").exists()).toBe(false);
    // The whole presentation-toggles section should not render
    expect(wrapper.find('[data-pi-section="presentation-toggles"]').exists()).toBe(
      false,
    );
  });
});

describe("PiComponent — toggle labels (orw.5 AC: verbatim text)", () => {
  it("renders the verbatim labels", async () => {
    const { wrapper } = await mountForAction("currently-playing");
    expect(
      wrapper.find("[data-pi-toggle-marquee-title] label").text(),
    ).toBe("Display Marquee Title");
    expect(
      wrapper.find("[data-pi-toggle-marquee-album-title] label").text(),
    ).toBe("Display Marquee Album Title");
    expect(wrapper.find("[data-pi-toggle-album-art] label").text()).toBe(
      "Display Album Art",
    );
  });

  it("renders Display State Based Title verbatim", async () => {
    const { wrapper } = await mountForAction("toggle-mute-unmute");
    expect(
      wrapper.find("[data-pi-toggle-state-based-title] label").text(),
    ).toBe("Display State Based Title");
  });
});

describe("PiComponent — toggle defaults (orw.5 AC: default off)", () => {
  it("AC: every switch defaults to off (unchecked) when settings has null/undefined", async () => {
    const { wrapper } = await mountForAction("currently-playing");
    expect(
      wrapper.find("[data-pi-toggle-marquee-title] input").element.checked,
    ).toBe(false);
    expect(
      wrapper.find("[data-pi-toggle-marquee-album-title] input").element
        .checked,
    ).toBe(false);
    expect(
      wrapper.find("[data-pi-toggle-album-art] input").element.checked,
    ).toBe(false);
  });

  it("renders checked when persisted setting is true", async () => {
    const { wrapper } = await mountForAction("toggle-mute-unmute");
    wrapper.vm.settings = { displayStateBasedTitle: true };
    await nextTick();
    expect(
      wrapper.find("[data-pi-toggle-state-based-title] input").element.checked,
    ).toBe(true);
  });
});

describe("PiComponent — toggle auto-save (orw.5 AC)", () => {
  it("AC: clicking a toggle calls sd.saveSettings with the updated field", async () => {
    const { wrapper, mockSd } = await mountForAction("toggle-mute-unmute");
    await wrapper
      .find("[data-pi-toggle-state-based-title] input")
      .setValue(true);
    expect(mockSd.saveSettings).toHaveBeenCalledTimes(1);
    const persisted = mockSd.saveSettings.mock.calls[0][0].actionSettings;
    expect(persisted.displayStateBasedTitle).toBe(true);
  });

  it("toggling off persists false (not null)", async () => {
    const { wrapper, mockSd } = await mountForAction("toggle-mute-unmute");
    wrapper.vm.settings = {
      action: PREFIX + "toggle-mute-unmute",
      displayStateBasedTitle: true,
    };
    await nextTick();
    await wrapper
      .find("[data-pi-toggle-state-based-title] input")
      .setValue(false);
    const persisted = mockSd.saveSettings.mock.calls[0][0].actionSettings;
    expect(persisted.displayStateBasedTitle).toBe(false);
  });
});
