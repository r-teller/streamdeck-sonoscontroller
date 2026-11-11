// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { OPERATIONAL_STATUS } from "@/modules/plugin/operationalStatus.js";

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

const h = vi.hoisted(() => ({
  constructorArgs: [],
  connect: vi.fn(),
  getDevices: vi.fn(),
  getFavorites: vi.fn(),
}));
vi.mock("@/modules/common/sonosController.js", () => ({
  SonosController: class {
    constructor(opts) {
      h.constructorArgs.push(opts);
    }
    connect(...args) {
      h.connect(...args);
      return this;
    }
    getDevices(...args) {
      return h.getDevices(...args);
    }
    getFavorites(...args) {
      return h.getFavorites(...args);
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

function flushPromises() {
  return new Promise((r) => setTimeout(r, 0));
}

describe("PiComponent Global Settings & saveAndConnect flow", () => {
  let wrapper;
  let stubClient;

  beforeEach(() => {
    wrapper = mount(PiComponent);
    stubClient = createStubClient();
    wrapper.vm.sdClient = stubClient;
    h.constructorArgs.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it("Fields raw-write locally", async () => {
    await wrapper.find("[data-pi-global-volume-increment]").setValue("0");
    await wrapper.find("[data-pi-device-timeout-duration]").setValue("0");
    // Vue v-model on type="number" coerces to Number; contract is RAW (0, unclamped), not string identity
    expect(wrapper.vm.adjustVolumeIncrement).toBe(0);
    expect(wrapper.vm.deviceTimeoutDuration).toBe(0);
    expect(stubClient.saveGlobalSettings).not.toHaveBeenCalled();
  });

  it("Clamp only at save", async () => {
    await wrapper.find("[data-pi-primary-device-address]").setValue("192.168.1.42");
    await wrapper.find("[data-pi-global-volume-increment]").setValue("0");
    const devicesFixture = [
      {
        primary: true,
        hostAddress: "192.168.1.42",
        port: 1400,
        zoneName: "Office",
        isSatellite: false,
        idleState: "ACTIVE",
        uuid: "RINCON_A",
      },
      {
        primary: false,
        hostAddress: "192.168.1.43",
        port: 1400,
        zoneName: "Den",
        isSatellite: false,
        idleState: "ACTIVE",
        uuid: "RINCON_B",
      },
    ];
    h.getDevices.mockResolvedValue(devicesFixture);
    h.getFavorites.mockResolvedValue([]);
    await wrapper.find("[data-pi-save-and-connect]").trigger("click");
    await flushPromises();
    const payload = stubClient.saveGlobalSettings.mock.calls[0][0].payload;
    expect(payload.adjustVolumeIncrement).toBe(1);
    expect(wrapper.vm.adjustVolumeIncrement).toBe(1);
  });

  it("Button disabled states", async () => {
    // empty address
    expect(wrapper.find("[data-pi-save-and-connect]").attributes("disabled")).toBeDefined();
    // whitespace only
    await wrapper.find("[data-pi-primary-device-address]").setValue("   ");
    expect(wrapper.find("[data-pi-save-and-connect]").attributes("disabled")).toBeDefined();
    // non‑empty
    await wrapper.find("[data-pi-primary-device-address]").setValue("192.168.1.42");
    expect(wrapper.find("[data-pi-save-and-connect]").attributes("disabled")).toBeUndefined();
  });

  it("Spinner + disabled while in flight", async () => {
    await wrapper.find("[data-pi-primary-device-address]").setValue("192.168.1.42");
    let resolveDevices;
    h.getDevices.mockReturnValue(
      new Promise((r) => {
        resolveDevices = r;
      }),
    );
    h.getFavorites.mockResolvedValue([]);
    await wrapper.find("[data-pi-save-and-connect]").trigger("click");
    await nextTick();
    expect(wrapper.find("[data-pi-save-and-connect-spinner]").exists()).toBe(true);
    expect(wrapper.find("[data-pi-save-and-connect]").attributes("disabled")).toBeDefined();
    expect(wrapper.vm.isDiscovering).toBe(true);
    // resolve devices
    const devicesFixture = [
      {
        primary: true,
        hostAddress: "192.168.1.42",
        port: 1400,
        zoneName: "Office",
        isSatellite: false,
        idleState: "ACTIVE",
        uuid: "RINCON_A",
      },
      {
        primary: false,
        hostAddress: "192.168.1.43",
        port: 1400,
        zoneName: "Den",
        isSatellite: false,
        idleState: "ACTIVE",
        uuid: "RINCON_B",
      },
    ];
    resolveDevices(devicesFixture);
    await flushPromises();
    expect(wrapper.find("[data-pi-save-and-connect-spinner]").exists()).toBe(false);
    expect(wrapper.vm.isDiscovering).toBe(false);
  });

  it("saveAndConnect happy path", async () => {
    // type address with surrounding spaces
    await wrapper.find("[data-pi-primary-device-address]").setValue(" 192.168.1.42 ");
    const devicesFixture = [
      {
        primary: true,
        hostAddress: "192.168.1.42",
        port: 1400,
        zoneName: "Office",
        isSatellite: false,
        idleState: "ACTIVE",
        uuid: "RINCON_A",
      },
      {
        primary: false,
        hostAddress: "192.168.1.43",
        port: 1400,
        zoneName: "Den",
        isSatellite: false,
        idleState: "ACTIVE",
        uuid: "RINCON_B",
      },
    ];
    const favoritesFixture = [
      {
        title: "Jazz",
        uri: "x-rincon:jazz",
        metadata: "<DIDL-Lite>meta</DIDL-Lite>",
        albumArtURI: "http://art/1.jpg",
      },
    ];
    h.getDevices.mockResolvedValue(devicesFixture);
    h.getFavorites.mockResolvedValue(favoritesFixture);
    await wrapper.find("[data-pi-save-and-connect]").trigger("click");
    await flushPromises();

    // controller construction
    expect(h.constructorArgs).toHaveLength(1);
    expect(h.constructorArgs[0]).toEqual({ timeoutSec: 10 });

    // connect call
    expect(h.connect).toHaveBeenCalledTimes(1);
    expect(h.connect).toHaveBeenCalledWith("192.168.1.42");

    // getDevices / getFavorites calls
    expect(h.getDevices).toHaveBeenCalledWith({ setAsPrimary: true });
    expect(h.getFavorites).toHaveBeenCalledTimes(1);

    // global settings payload
    const globalPayload = stubClient.saveGlobalSettings.mock.calls[0][0].payload;
    expect(globalPayload.devices.RINCON_A.zoneName).toBe("Office");
    expect(globalPayload.favorites).toEqual(favoritesFixture);
    expect(globalPayload.deviceCheckInterval).toBe(10);
    expect(globalPayload.deviceTimeoutDuration).toBe(10);
    expect(globalPayload.adjustVolumeIncrement).toBe(10);

    // component state
    expect(wrapper.vm.speakers).toHaveLength(2);
    expect(wrapper.vm.errorMessage).toBe("");
    expect(wrapper.vm.isConnected).toBe(true);
    const btn = wrapper.find("[data-pi-save-and-connect]");
    expect(btn.text()).toContain("Save and Reconnect");

    // default bind saveSettings
    expect(stubClient.saveSettings).toHaveBeenCalledTimes(1);
    const savedSettings = stubClient.saveSettings.mock.calls[0][0].actionSettings;
    expect(savedSettings.uuid).toBe("RINCON_A");
    expect(savedSettings.title).toBe("Office (192.168.1.42)");
    expect(Object.keys(savedSettings)).toHaveLength(26);
  });

  it("No clobber of existing binding", async () => {
    wrapper.vm.settings = { uuid: "RINCON_EXISTING" };
    await wrapper.find("[data-pi-primary-device-address]").setValue("192.168.1.42");
    h.getDevices.mockResolvedValue([]);
    h.getFavorites.mockResolvedValue([]);
    await wrapper.find("[data-pi-save-and-connect]").trigger("click");
    await flushPromises();
    expect(stubClient.saveSettings).not.toHaveBeenCalled();
  });

  it("Failure path", async () => {
    await wrapper.find("[data-pi-primary-device-address]").setValue("192.168.1.42");
    const errMsg = "Failed to get devices: Timeout while reaching 192.168.1.42:1400 after 10 seconds";
    h.getDevices.mockRejectedValue(new Error(errMsg));
    h.getFavorites.mockResolvedValue([]);
    await wrapper.find("[data-pi-save-and-connect]").trigger("click");
    await flushPromises();
    const alert = wrapper.find("[data-pi-error-alert]");
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain(errMsg);
    expect(stubClient.saveGlobalSettings).not.toHaveBeenCalled();
    expect(stubClient.saveSettings).not.toHaveBeenCalled();
    expect(wrapper.vm.isConnected).toBe(false);
    expect(wrapper.vm.isDiscovering).toBe(false);
    expect(wrapper.find("[data-pi-save-and-connect]").attributes("disabled")).toBeUndefined();
  });

  it("Error dismiss", async () => {
    // simulate error state
    wrapper.vm.errorMessage = "boom";
    await nextTick();
    const dismissBtn = wrapper.find("[data-pi-error-dismiss]");
    await dismissBtn.trigger("click");
    expect(wrapper.find("[data-pi-error-alert]").exists()).toBe(false);
    expect(wrapper.vm.errorMessage).toBe("");
  });

  it("Accordion expansion contract", async () => {
    const accButton = wrapper.find('[data-pi-section="global-settings"] .accordion-button');
    expect(accButton.attributes("aria-expanded")).toBe("true");
  });
});
