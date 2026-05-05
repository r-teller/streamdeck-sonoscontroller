// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("@/modules/common/sdConnect.js", () => ({
  streamDeckReady: new Promise(() => {}),
  installStreamDeckBridge: vi.fn(),
  getStreamDeckClient: vi.fn(() => null),
}));

import PiComponent from "@/components/PiComponent.vue";

const ALERT = "[data-pi-bound-speaker-alert]";

describe("PiComponent — selected-speaker alert (orw.4)", () => {
  let wrapper;

  beforeEach(() => {
    wrapper = mount(PiComponent);
  });

  it("AC: hidden when no speaker is bound (settings.uuid falsy) — never blank-with-borders", () => {
    expect(wrapper.find(ALERT).exists()).toBe(false);
  });

  it("AC: renders ZoneName (HostAddress) when a speaker is bound", async () => {
    wrapper.vm.settings.uuid = "RINCON_office";
    wrapper.vm.settings.zoneName = "Office";
    wrapper.vm.settings.hostAddress = "192.168.1.42";
    await wrapper.vm.$nextTick();

    const alert = wrapper.find(ALERT);
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toBe("Office (192.168.1.42)");
  });

  it("AC: rebinding to a different speaker updates the text within the same render cycle", async () => {
    wrapper.vm.settings.uuid = "RINCON_office";
    wrapper.vm.settings.zoneName = "Office";
    wrapper.vm.settings.hostAddress = "192.168.1.42";
    await wrapper.vm.$nextTick();
    expect(wrapper.find(ALERT).text()).toBe("Office (192.168.1.42)");

    wrapper.vm.settings.uuid = "RINCON_kitchen";
    wrapper.vm.settings.zoneName = "Kitchen";
    wrapper.vm.settings.hostAddress = "192.168.1.43";
    await wrapper.vm.$nextTick();
    expect(wrapper.find(ALERT).text()).toBe("Kitchen (192.168.1.43)");
  });

  it("does not render the satellite icon (🛰️ belongs to the picker, not the binding alert)", async () => {
    wrapper.vm.settings.uuid = "RINCON_satellite";
    wrapper.vm.settings.zoneName = "Living Room";
    wrapper.vm.settings.hostAddress = "192.168.1.50";
    await wrapper.vm.$nextTick();
    expect(wrapper.find(ALERT).text()).not.toContain("🛰️");
  });

  it("uses Bootstrap alert-light styling (not the red error variant)", async () => {
    wrapper.vm.settings.uuid = "RINCON_x";
    wrapper.vm.settings.zoneName = "X";
    wrapper.vm.settings.hostAddress = "1.1.1.1";
    await wrapper.vm.$nextTick();
    const alert = wrapper.find(ALERT);
    expect(alert.classes()).toContain("alert");
    expect(alert.classes()).toContain("alert-light");
    expect(alert.classes()).not.toContain("alert-danger");
  });

  it("AC: alert is rendered inside the sonos-speakers section (sibling of the picker accordion)", async () => {
    wrapper.vm.settings.uuid = "RINCON_x";
    wrapper.vm.settings.zoneName = "X";
    wrapper.vm.settings.hostAddress = "1.1.1.1";
    await wrapper.vm.$nextTick();
    const section = wrapper.find('[data-pi-section="sonos-speakers"]');
    expect(section.exists()).toBe(true);
    expect(section.find(ALERT).exists()).toBe(true);
  });

  it("AC: alert is visible regardless of accordion/connection state — no v-if gating on isConnected", async () => {
    // isConnected drives the picker accordion's v-if; the alert must be
    // always-visible once a speaker is bound, even before/after discovery.
    wrapper.vm.settings.uuid = "RINCON_x";
    wrapper.vm.settings.zoneName = "Office";
    wrapper.vm.settings.hostAddress = "192.168.1.42";

    // disconnected
    wrapper.vm.globalSettings = {};
    await wrapper.vm.$nextTick();
    expect(wrapper.find(ALERT).exists()).toBe(true);

    // connected
    wrapper.vm.globalSettings = { devices: { RINCON_x: { primary: true } } };
    await wrapper.vm.$nextTick();
    expect(wrapper.find(ALERT).exists()).toBe(true);
  });
});
