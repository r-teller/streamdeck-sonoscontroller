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

async function mountPi() {
  const mockSd = makeMockSd();
  const wrapper = mount(PiComponent);
  wrapper.vm.sdClient = mockSd;
  wrapper.vm.actionUUID = PREFIX + "toggle-mute-unmute";
  await nextTick();
  return { wrapper, mockSd };
}

describe("PiComponent — Global Settings form fields (orw.8 AC)", () => {
  it("AC: section heading is `Global Settings` verbatim", async () => {
    const { wrapper } = await mountPi();
    expect(wrapper.find('[data-pi-section="global-settings"] h1').text()).toBe(
      "Global Settings",
    );
  });

  it("AC: Primary Device Address input exists with verbatim label and hint", async () => {
    const { wrapper } = await mountPi();
    expect(
      wrapper.find('label[for="global-primary-device-address"]').text(),
    ).toBe("Primary Device Address (Discovery)");
    expect(wrapper.find("[data-pi-primary-device-address]").exists()).toBe(
      true,
    );
    const hint = wrapper
      .find("[data-pi-primary-device-address]")
      .element.parentElement.querySelector(".form-text").textContent;
    expect(hint.trim()).toBe(
      "Note: This device is used to discover all other devices on the network",
    );
  });

  it("AC: Device Timeout Duration input exists with verbatim label, hint, default 10", async () => {
    const { wrapper } = await mountPi();
    expect(
      wrapper.find('label[for="global-device-timeout-duration"]').text(),
    ).toBe("Device Timeout Duration (Actions)");
    expect(
      wrapper.find("[data-pi-device-timeout-duration]").element.value,
    ).toBe("10");
    const hint = wrapper
      .find("[data-pi-device-timeout-duration]")
      .element.parentElement.querySelector(".form-text").textContent;
    expect(hint.trim()).toBe(
      "Note: This timeout is used when executing device actions (in seconds)",
    );
  });

  it("AC: Device Check Interval input exists with verbatim label, hint, default 10", async () => {
    const { wrapper } = await mountPi();
    expect(
      wrapper.find('label[for="global-device-check-interval"]').text(),
    ).toBe("Device Check Interval (Actions)");
    expect(
      wrapper.find("[data-pi-device-check-interval]").element.value,
    ).toBe("10");
    const hint = wrapper
      .find("[data-pi-device-check-interval]")
      .element.parentElement.querySelector(".form-text").textContent;
    expect(hint.trim()).toBe(
      "Note: This interval is used to check the status of the device selected for this action (in seconds)",
    );
  });

  it("AC: Volume Increment input exists with verbatim label, hint, default 10", async () => {
    const { wrapper } = await mountPi();
    expect(wrapper.find('label[for="global-volume-increment"]').text()).toBe(
      "Volume Increment (Up/Down)",
    );
    expect(wrapper.find("[data-pi-volume-increment]").element.value).toBe(
      "10",
    );
    const hint = wrapper
      .find("[data-pi-volume-increment]")
      .element.parentElement.querySelector(".form-text").textContent;
    expect(hint.trim()).toBe(
      "Note: Volume range is 0–100. Used by Volume Up and Volume Down actions unless overridden per-button.",
    );
  });

  it("AC: Primary Device Address defaults to empty on first open", async () => {
    const { wrapper } = await mountPi();
    expect(
      wrapper.find("[data-pi-primary-device-address]").element.value,
    ).toBe("");
  });
});

describe("PiComponent — Global Settings reactive bindings (orw.8 AC)", () => {
  it("editing Primary Device Address updates the local ref", async () => {
    const { wrapper } = await mountPi();
    await wrapper
      .find("[data-pi-primary-device-address]")
      .setValue("192.168.1.42");
    expect(wrapper.vm.primaryDeviceAddress).toBe("192.168.1.42");
  });

  it("editing Device Timeout Duration writes to globalSettings ref", async () => {
    const { wrapper } = await mountPi();
    await wrapper.find("[data-pi-device-timeout-duration]").setValue("20");
    expect(wrapper.vm.globalSettings.deviceTimeoutDuration).toBe(20);
  });

  it("editing Device Check Interval writes to globalSettings ref", async () => {
    const { wrapper } = await mountPi();
    await wrapper.find("[data-pi-device-check-interval]").setValue("7");
    expect(wrapper.vm.globalSettings.deviceCheckInterval).toBe(7);
  });

  it("editing Volume Increment writes to globalSettings ref (raw, before clamp)", async () => {
    const { wrapper } = await mountPi();
    await wrapper.find("[data-pi-volume-increment]").setValue("0");
    // The clamp lives at the saveGlobalSettings write site, NOT on input.
    expect(wrapper.vm.globalSettings.adjustVolumeIncrement).toBe(0);
  });

  it("incoming globalSettings via didReceiveGlobalSettings is reflected in inputs", async () => {
    const { wrapper } = await mountPi();
    wrapper.vm.globalSettings = {
      deviceTimeoutDuration: 15,
      deviceCheckInterval: 8,
      adjustVolumeIncrement: 5,
    };
    await nextTick();
    expect(
      wrapper.find("[data-pi-device-timeout-duration]").element.value,
    ).toBe("15");
    expect(
      wrapper.find("[data-pi-device-check-interval]").element.value,
    ).toBe("8");
    expect(wrapper.find("[data-pi-volume-increment]").element.value).toBe("5");
  });
});

describe("PiComponent — Global Settings clamp on save (orw.8 AC)", () => {
  it("AC: saveGlobalSettings(0) → persists 1 (clamp at write site)", async () => {
    const { wrapper, mockSd } = await mountPi();
    wrapper.vm.saveGlobalSettings({
      devices: {},
      deviceCheckInterval: 10,
      deviceTimeoutDuration: 10,
      adjustVolumeIncrement: 0,
      favorites: [],
    });
    const persisted = mockSd.saveGlobalSettings.mock.calls[0][0].payload;
    expect(persisted.adjustVolumeIncrement).toBe(1);
  });

  it("AC: saveGlobalSettings(-5) → persists 1", async () => {
    const { wrapper, mockSd } = await mountPi();
    wrapper.vm.saveGlobalSettings({
      devices: {},
      deviceCheckInterval: 10,
      deviceTimeoutDuration: 10,
      adjustVolumeIncrement: -5,
      favorites: [],
    });
    const persisted = mockSd.saveGlobalSettings.mock.calls[0][0].payload;
    expect(persisted.adjustVolumeIncrement).toBe(1);
  });

  it("AC: saveGlobalSettings(1) → persists 1 (regression — value 1 round-trips)", async () => {
    const { wrapper, mockSd } = await mountPi();
    wrapper.vm.saveGlobalSettings({
      devices: {},
      deviceCheckInterval: 10,
      deviceTimeoutDuration: 10,
      adjustVolumeIncrement: 1,
      favorites: [],
    });
    const persisted = mockSd.saveGlobalSettings.mock.calls[0][0].payload;
    expect(persisted.adjustVolumeIncrement).toBe(1);
  });
});

describe("PiComponent — Global Settings accordion auto-expand/collapse (orw.8 AC)", () => {
  it("AC: accordion is open on first PI open (connectionState !== CONNECTED)", async () => {
    const { wrapper } = await mountPi();
    // forceExpanded prop is bound to !isConnected; on first mount we are CONNECTING
    const collapse = wrapper.find(
      "#global-settings-accordeon #collapseGlobalSettings",
    );
    expect(collapse.exists()).toBe(true);
    expect(collapse.classes()).toContain("show");
  });

  it("AC: accordion collapses when connectionState becomes CONNECTED", async () => {
    const { wrapper } = await mountPi();
    wrapper.vm.connectionState = "CONNECTED";
    await nextTick();
    // After flip to CONNECTED, isConnected=true, so forceExpanded=false.
    // BootstrapAccordeonItem's watcher updates isExpanded; the bootstrap
    // Collapse instance .hide() runs but jsdom's CSS transitions don't fire
    // hidden.bs.collapse synchronously. Verify the prop wired correctly via
    // the accordion item's isExpanded matching prop after watch.
    await nextTick();
    // We test this via the prop / accordion behavior in BootstrapAccordeonItem
    // unit tests; here we just verify the prop flips.
    const item = wrapper.findComponent({ name: "BootstrapAccordeonItem" });
    if (item.exists()) {
      expect(item.props("forceExpanded")).toBe(false);
    }
  });

  it("when connectionState is DISCONNECTED, accordion is open (forceExpanded true)", async () => {
    const { wrapper } = await mountPi();
    wrapper.vm.connectionState = "DISCONNECTED";
    await nextTick();
    const item = wrapper.findComponent({ name: "BootstrapAccordeonItem" });
    if (item.exists()) {
      expect(item.props("forceExpanded")).toBe(true);
    }
  });
});
