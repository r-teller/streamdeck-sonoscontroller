// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

// Mock sdConnect so PiComponent never tries to touch a real WebSocket bridge.
vi.mock("@/modules/common/sdConnect.js", () => ({
  // Pending promise — `bindStreamDeck` never auto-runs in tests; we inject the
  // sd client directly via `wrapper.vm.sdClient = mock` for assertion.
  streamDeckReady: new Promise(() => {}),
  installStreamDeckBridge: vi.fn(),
  getStreamDeckClient: vi.fn(() => null),
}));

import PiComponent from "@/components/PiComponent.vue";

function makeMockSd() {
  return {
    saveGlobalSettings: vi.fn(),
    saveSettings: vi.fn(),
  };
}

describe("PiComponent.saveGlobalSettings — integration (orw.12)", () => {
  let wrapper;
  let mockSd;

  beforeEach(() => {
    mockSd = makeMockSd();
    wrapper = mount(PiComponent);
    wrapper.vm.sdClient = mockSd;
  });

  it("invokes sd.saveGlobalSettings with payload wrapped under `payload` key", () => {
    wrapper.vm.saveGlobalSettings({
      devices: {},
      deviceCheckInterval: 10,
      deviceTimeoutDuration: 10,
      adjustVolumeIncrement: 10,
      favorites: [],
    });
    expect(mockSd.saveGlobalSettings).toHaveBeenCalledTimes(1);
    const callArg = mockSd.saveGlobalSettings.mock.calls[0][0];
    expect(callArg).toHaveProperty("payload");
  });

  it("clamps adjustVolumeIncrement = 0 → 1 in persisted payload (regression)", () => {
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

  it("preserves adjustVolumeIncrement = 1 verbatim (clamp does not coerce)", () => {
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

  it("updates local globalSettings ref to the persisted payload (in-process cache)", () => {
    wrapper.vm.saveGlobalSettings({
      devices: { RINCON_a: { uuid: "RINCON_a", primary: true, port: 1400 } },
      deviceCheckInterval: 10,
      deviceTimeoutDuration: 10,
      adjustVolumeIncrement: 5,
      favorites: [],
    });
    expect(wrapper.vm.globalSettings.devices.RINCON_a.uuid).toBe("RINCON_a");
    expect(wrapper.vm.globalSettings.adjustVolumeIncrement).toBe(5);
  });

  it("returns null and does not throw when sdClient is unset", () => {
    wrapper.vm.sdClient = null;
    const result = wrapper.vm.saveGlobalSettings({
      devices: {},
      deviceCheckInterval: 10,
      deviceTimeoutDuration: 10,
      adjustVolumeIncrement: 10,
      favorites: [],
    });
    expect(result).toBe(null);
    expect(mockSd.saveGlobalSettings).not.toHaveBeenCalled();
  });

  it("passes 5-key payload (no extras, no missing) to sd.saveGlobalSettings", () => {
    wrapper.vm.saveGlobalSettings({
      devices: {},
      deviceCheckInterval: 10,
      deviceTimeoutDuration: 10,
      adjustVolumeIncrement: 10,
      favorites: [],
    });
    const persisted = mockSd.saveGlobalSettings.mock.calls[0][0].payload;
    expect(Object.keys(persisted).sort()).toEqual([
      "adjustVolumeIncrement",
      "deviceCheckInterval",
      "deviceTimeoutDuration",
      "devices",
      "favorites",
    ]);
  });
});
