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

async function mountForAction(actionShortName, globalIncrement = 10) {
  const mockSd = makeMockSd();
  const wrapper = mount(PiComponent);
  wrapper.vm.sdClient = mockSd;
  wrapper.vm.actionUUID = PREFIX + actionShortName;
  wrapper.vm.globalSettings = { adjustVolumeIncrement: globalIncrement };
  await nextTick();
  return { wrapper, mockSd };
}

describe("PiComponent — Volume Increment override visibility (orw.7 AC)", () => {
  it("AC: visible on volume-up", async () => {
    const { wrapper } = await mountForAction("volume-up");
    expect(
      wrapper.find('[data-pi-section="volume-increment-override"]').exists(),
    ).toBe(true);
  });

  it("AC: visible on volume-down", async () => {
    const { wrapper } = await mountForAction("volume-down");
    expect(
      wrapper.find('[data-pi-section="volume-increment-override"]').exists(),
    ).toBe(true);
  });

  it("AC: NOT visible on toggle-mute-unmute", async () => {
    const { wrapper } = await mountForAction("toggle-mute-unmute");
    expect(
      wrapper.find('[data-pi-section="volume-increment-override"]').exists(),
    ).toBe(false);
  });

  it("AC: NOT visible on play-next-track", async () => {
    const { wrapper } = await mountForAction("play-next-track");
    expect(
      wrapper.find('[data-pi-section="volume-increment-override"]').exists(),
    ).toBe(false);
  });
});

describe("PiComponent — Volume Increment override labels and helper (orw.7 AC)", () => {
  it("AC: section heading is `Volume Increment` verbatim", async () => {
    const { wrapper } = await mountForAction("volume-up");
    expect(
      wrapper.find('[data-pi-section="volume-increment-override"] h1').text(),
    ).toBe("Volume Increment");
  });

  it("AC: label is verbatim `Override increment (leave empty to use global default)`", async () => {
    const { wrapper } = await mountForAction("volume-up");
    const label = wrapper.find(
      '[data-pi-section="volume-increment-override"] label',
    );
    expect(label.text()).toBe(
      "Override increment (leave empty to use global default)",
    );
  });

  it("AC: helper text is verbatim `Volume range: 0–100`", async () => {
    const { wrapper } = await mountForAction("volume-up");
    const helper = wrapper.find(
      '[data-pi-section="volume-increment-override"] .form-text',
    );
    expect(helper.text()).toBe("Volume range: 0–100");
  });
});

describe("PiComponent — Volume Increment placeholder reflects global (orw.7 AC)", () => {
  it("AC: placeholder shows `Global default: 10` when global is 10", async () => {
    const { wrapper } = await mountForAction("volume-up", 10);
    expect(
      wrapper
        .find("[data-pi-volume-increment-override]")
        .attributes("placeholder"),
    ).toBe("Global default: 10");
  });

  it("AC: placeholder shows `Global default: 5` when global is 5", async () => {
    const { wrapper } = await mountForAction("volume-up", 5);
    expect(
      wrapper
        .find("[data-pi-volume-increment-override]")
        .attributes("placeholder"),
    ).toBe("Global default: 5");
  });

  it("placeholder falls back to 10 when global has no adjustVolumeIncrement", async () => {
    const { wrapper } = await mountForAction("volume-up");
    wrapper.vm.globalSettings = {};
    await nextTick();
    expect(
      wrapper
        .find("[data-pi-volume-increment-override]")
        .attributes("placeholder"),
    ).toBe("Global default: 10");
  });
});

describe("PiComponent — Volume Increment validation (orw.7 AC)", () => {
  it("input has min='1' attribute", async () => {
    const { wrapper } = await mountForAction("volume-up");
    expect(
      wrapper.find("[data-pi-volume-increment-override]").attributes("min"),
    ).toBe("1");
  });
});

describe("PiComponent — Volume Increment auto-save (orw.7 AC: PR #4 regression)", () => {
  it("PR #4 regression: entering 1 persists adjustVolumeIncrement=1 (NOT null)", async () => {
    const { wrapper, mockSd } = await mountForAction("volume-up");
    const input = wrapper.find("[data-pi-volume-increment-override]");
    await input.setValue("1");
    expect(mockSd.saveSettings).toHaveBeenCalled();
    const persisted =
      mockSd.saveSettings.mock.calls.at(-1)[0].actionSettings;
    expect(persisted.adjustVolumeIncrement).toBe(1);
  });

  it("entering 15 persists adjustVolumeIncrement=15", async () => {
    const { wrapper, mockSd } = await mountForAction("volume-up");
    const input = wrapper.find("[data-pi-volume-increment-override]");
    await input.setValue("15");
    const persisted =
      mockSd.saveSettings.mock.calls.at(-1)[0].actionSettings;
    expect(persisted.adjustVolumeIncrement).toBe(15);
  });

  it("AC: clearing the input persists null (inherit global default)", async () => {
    const { wrapper, mockSd } = await mountForAction("volume-up");
    const input = wrapper.find("[data-pi-volume-increment-override]");
    await input.setValue("15");
    await input.setValue("");
    const persisted =
      mockSd.saveSettings.mock.calls.at(-1)[0].actionSettings;
    expect(persisted.adjustVolumeIncrement).toBe(null);
  });

  it("input value reflects persisted setting (1 round-trips visibly)", async () => {
    const { wrapper } = await mountForAction("volume-up");
    wrapper.vm.settings = {
      action: PREFIX + "volume-up",
      adjustVolumeIncrement: 1,
    };
    await nextTick();
    expect(
      wrapper.find("[data-pi-volume-increment-override]").element.value,
    ).toBe("1");
  });

  it("input shows empty string when persisted value is null", async () => {
    const { wrapper } = await mountForAction("volume-up");
    wrapper.vm.settings = {
      action: PREFIX + "volume-up",
      adjustVolumeIncrement: null,
    };
    await nextTick();
    expect(
      wrapper.find("[data-pi-volume-increment-override]").element.value,
    ).toBe("");
  });
});
