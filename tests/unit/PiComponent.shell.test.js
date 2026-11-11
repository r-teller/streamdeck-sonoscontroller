// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
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

describe("PiComponent shell", () => {
  let wrapper;
  let stubClient;

  beforeEach(() => {
    wrapper = mount(PiComponent);
    stubClient = createStubClient();
    // expose stub client for tests that need it
    wrapper.vm.sdClient = stubClient;
  });

  it("renders empty state when Stream Deck bridge not ready", async () => {
    expect(wrapper.vm.connectionState).toBe(OPERATIONAL_STATUS.CONNECTING);
    const hint = wrapper.find("[data-pi-disconnected-hint]");
    expect(hint.exists()).toBe(true);
    expect(hint.isVisible()).toBe(true);
    expect(hint.text()).toBe('Set the Primary Device Address below and tap "Save and Connect" to discover your speakers.');
    expect(wrapper.find("[data-pi-speaker-picker]").exists()).toBe(false);
    expect(wrapper.find("[data-pi-bound-speaker-alert]").exists()).toBe(false);
    expect(wrapper.find('[data-pi-section="sonos-speakers"]').exists()).toBe(true);
    expect(wrapper.find('[data-pi-section="global-settings"]').exists()).toBe(true);
  });

  it("bindStreamDeck handles already‑connected race", async () => {
    const client = {
      ...stubClient,
      on: vi.fn(),
      connected: true,
      actionInfo: {
        action: "com.r-teller.sonoscontroller.volume-up",
        payload: {
          settings: {
            uuid: "RINCON_X",
            title: "Office (192.168.1.42)",
            hostAddress: "192.168.1.42",
            zoneName: "Office",
          },
        },
      },
    };
    wrapper.vm.bindStreamDeck(client);
    expect(wrapper.vm.actionUUID).toBe("com.r-teller.sonoscontroller.volume-up");
    expect(wrapper.vm.settings).toEqual({
      uuid: "RINCON_X",
      title: "Office (192.168.1.42)",
      hostAddress: "192.168.1.42",
      zoneName: "Office",
    });
    expect(wrapper.vm.connectionState).toBe(OPERATIONAL_STATUS.CONNECTED);
    expect(client.requestGlobalSettings).toHaveBeenCalledTimes(1);
    expect(client.on).toHaveBeenCalledTimes(6);
    expect(client.on).toHaveBeenCalledWith("sendToPropertyInspector", expect.any(Function));
    expect(client.on).toHaveBeenCalledWith("connected", expect.any(Function));
    expect(client.on).toHaveBeenCalledWith("disconnected", expect.any(Function));
    expect(client.on).toHaveBeenCalledWith("error", expect.any(Function));
    expect(client.on).toHaveBeenCalledWith("didReceiveSettings", expect.any(Function));
    expect(client.on).toHaveBeenCalledWith("globalsettings", expect.any(Function));
  });

  it("reopens from persisted devices without network call", async () => {
    wrapper.vm.sdClient = stubClient;
    wrapper.vm.connectionState = OPERATIONAL_STATUS.CONNECTED;
    wrapper.vm.globalSettings = {
      devices: {
        RINCON_A: {
          uuid: "RINCON_A",
          zoneName: "Office",
          hostAddress: "192.168.1.42",
          isSatellite: false,
          primary: true,
          port: 1400,
        },
        RINCON_B: {
          uuid: "RINCON_B",
          zoneName: "Den",
          hostAddress: "192.168.1.43",
          isSatellite: true,
          primary: false,
          port: 1400,
        },
      },
    };
    await nextTick();
    await nextTick(); // watcher chain
    expect(wrapper.vm.speakers).toHaveLength(2);
    expect(wrapper.vm.speakers[0]).toMatchObject({
      uuid: "RINCON_A",
      zoneName: "Office",
      hostAddress: "192.168.1.42",
      isSatellite: false,
    });
    expect(wrapper.vm.speakers[1]).toMatchObject({
      uuid: "RINCON_B",
      zoneName: "Den",
      hostAddress: "192.168.1.43",
      isSatellite: true,
    });
    expect(wrapper.find("[data-pi-speaker-picker]").exists()).toBe(true);
    expect(wrapper.vm.primaryDeviceAddress).toBe("192.168.1.42");
  });

  it("default‑binds to primary when action UUID changes and no speaker bound", async () => {
    wrapper.vm.sdClient = stubClient;
    wrapper.vm.settings = {}; // no uuid
    wrapper.vm.globalSettings = {
      devices: {
        RINCON_A: {
          uuid: "RINCON_A",
          zoneName: "Office",
          hostAddress: "192.168.1.42",
          isSatellite: false,
          primary: true,
          port: 1400,
        },
      },
    };
    wrapper.vm.actionUUID = "com.r-teller.sonoscontroller.toggle-play-pause";
    await nextTick();
    expect(stubClient.saveSettings).toHaveBeenCalledTimes(1);
    const payload = stubClient.saveSettings.mock.calls[0][0].actionSettings;
    expect(payload.uuid).toBe("RINCON_A");
    expect(payload.title).toBe("Office (192.168.1.42)");
    expect(Object.keys(payload)).toHaveLength(26);
  });

  it("does not clobber existing bound speaker", async () => {
    wrapper.vm.sdClient = stubClient;
    wrapper.vm.settings = { uuid: "RINCON_EXISTING" };
    wrapper.vm.globalSettings = {
      devices: {
        RINCON_A: {
          uuid: "RINCON_A",
          zoneName: "Office",
          hostAddress: "192.168.1.42",
          isSatellite: false,
          primary: true,
          port: 1400,
        },
      },
    };
    wrapper.vm.actionUUID = "com.r-teller.sonoscontroller.toggle-play-pause";
    await nextTick();
    expect(stubClient.saveSettings).not.toHaveBeenCalled();
  });

  it("shows and hides bound‑speaker alert based on settings", async () => {
    wrapper.vm.settings = { uuid: "RINCON_X", title: "Office (192.168.1.42)" };
    await nextTick();
    const alert = wrapper.find("[data-pi-bound-speaker-alert]");
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("Office (192.168.1.42)");
    wrapper.vm.settings = {};
    await nextTick();
    expect(wrapper.find("[data-pi-bound-speaker-alert]").exists()).toBe(false);
  });

  it("picker selection saves full payload", async () => {
    // prepare connected state with devices
    wrapper.vm.sdClient = stubClient;
    wrapper.vm.connectionState = OPERATIONAL_STATUS.CONNECTED;
    wrapper.vm.globalSettings = {
      devices: {
        RINCON_A: {
          uuid: "RINCON_A",
          zoneName: "Office",
          hostAddress: "192.168.1.42",
          isSatellite: false,
          primary: true,
          port: 1400,
        },
        RINCON_B: {
          uuid: "RINCON_B",
          zoneName: "Den",
          hostAddress: "192.168.1.43",
          isSatellite: true,
          primary: false,
          port: 1400,
        },
      },
    };
    await nextTick();
    await nextTick(); // ensure speakers built
    wrapper.vm.actionUUID = "com.r-teller.sonoscontroller.volume-up";
    wrapper.vm.settings = {};
    await nextTick();
    stubClient.saveSettings.mockClear();
    const picker = wrapper.find("[data-pi-speaker-picker]");
    await picker.setValue("RINCON_B");
    await nextTick();
    expect(stubClient.saveSettings).toHaveBeenCalledTimes(1);
    const payload = stubClient.saveSettings.mock.calls[0][0].actionSettings;
    expect(payload.uuid).toBe("RINCON_B");
    expect(payload.title).toBe("Den (192.168.1.43)");
    expect(payload.adjustVolumeIncrement).toBeNull();
    expect(payload.selectedPlayModes).toBeNull();
    expect(payload.displayStateBasedTitle).toBe(false);
    expect(Object.keys(payload)).toHaveLength(26);
  });

  it("handles didReceiveSettings, globalsettings and disconnected events", async () => {
    const client = createStubClient();
    wrapper.vm.bindStreamDeck(client);
    const handlers = client.__handlers;
    // didReceiveSettings
    handlers.didReceiveSettings({ payload: { settings: { uuid: "RINCON_Z" } } });
    expect(wrapper.vm.settings.uuid).toBe("RINCON_Z");
    // globalsettings
    handlers.globalsettings(undefined);
    expect(wrapper.vm.globalSettings).toEqual({});
    // disconnected
    handlers.disconnected();
    expect(wrapper.vm.connectionState).toBe(OPERATIONAL_STATUS.DISCONNECTED);
  });
});
