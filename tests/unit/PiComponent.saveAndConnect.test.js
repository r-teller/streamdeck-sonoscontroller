// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

vi.mock("@/modules/common/sdConnect.js", () => ({
  streamDeckReady: new Promise(() => {}),
  installStreamDeckBridge: vi.fn(),
  getStreamDeckClient: vi.fn(() => null),
}));

// SonosController mock — each test installs its own getDevices/getFavorites
// behavior via the `__configure` hook before mounting.
const sonosControllerImpl = {
  getDevices: vi.fn(),
  getFavorites: vi.fn(),
  connect: vi.fn(),
  timeoutSec: 10,
};

vi.mock("@/modules/common/sonosController.js", () => {
  return {
    SonosController: vi.fn().mockImplementation((opts) => {
      sonosControllerImpl.timeoutSec = opts?.timeoutSec ?? 10;
      return sonosControllerImpl;
    }),
  };
});

import PiComponent from "@/components/PiComponent.vue";
import { SonosController } from "@/modules/common/sonosController.js";

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

beforeEach(() => {
  sonosControllerImpl.getDevices.mockReset();
  sonosControllerImpl.getFavorites.mockReset();
  sonosControllerImpl.connect.mockReset().mockReturnValue(sonosControllerImpl);
  SonosController.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────────────────
// Button label, disabled state, spinner
// ────────────────────────────────────────────────────────────────────────────

describe("Save and Connect button — label flip (orw.9 AC)", () => {
  it("AC: reads `Save and Connect` when not connected", async () => {
    const { wrapper } = await mountPi();
    expect(wrapper.find("[data-pi-save-and-connect]").text().trim()).toBe(
      "Save and Connect",
    );
  });

  it("AC: reads `Save and Reconnect` after connectionState === CONNECTED", async () => {
    const { wrapper } = await mountPi();
    wrapper.vm.connectionState = "CONNECTED";
    await nextTick();
    expect(wrapper.find("[data-pi-save-and-connect]").text().trim()).toBe(
      "Save and Reconnect",
    );
  });
});

describe("Save and Connect button — disabled state (orw.9 AC)", () => {
  it("AC: disabled when primaryDeviceAddress is empty (first run)", async () => {
    const { wrapper } = await mountPi();
    const btn = wrapper.find("[data-pi-save-and-connect]");
    expect(btn.attributes("disabled")).toBeDefined();
  });

  it("AC: enabled after typing a non-empty primary device address", async () => {
    const { wrapper } = await mountPi();
    await wrapper
      .find("[data-pi-primary-device-address]")
      .setValue("192.168.1.42");
    expect(
      wrapper.find("[data-pi-save-and-connect]").attributes("disabled"),
    ).toBeUndefined();
  });

  it("AC: disabled when only whitespace in primary device address", async () => {
    const { wrapper } = await mountPi();
    await wrapper.find("[data-pi-primary-device-address]").setValue("   ");
    expect(
      wrapper.find("[data-pi-save-and-connect]").attributes("disabled"),
    ).toBeDefined();
  });
});

describe("Save and Connect button — spinner during flight (orw.9 AC)", () => {
  it("AC: shows spinner inside the button while a discovery call is in flight", async () => {
    const { wrapper } = await mountPi();
    let resolveDevices;
    sonosControllerImpl.getDevices.mockReturnValue(
      new Promise((r) => {
        resolveDevices = r;
      }),
    );
    sonosControllerImpl.getFavorites.mockResolvedValue([]);

    await wrapper
      .find("[data-pi-primary-device-address]")
      .setValue("192.168.1.42");
    wrapper.vm.saveAndConnect();
    await nextTick();

    expect(
      wrapper.find("[data-pi-save-and-connect-spinner]").exists(),
    ).toBe(true);
    expect(
      wrapper.find("[data-pi-save-and-connect]").attributes("disabled"),
    ).toBeDefined();

    resolveDevices([]);
    await new Promise((r) => setTimeout(r, 0));
    await nextTick();

    expect(
      wrapper.find("[data-pi-save-and-connect-spinner]").exists(),
    ).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Discovery flow happy paths (PR #3 tolerance fixtures)
// ────────────────────────────────────────────────────────────────────────────

describe("Save and Connect — PR #3 tolerance (orw.9 AC)", () => {
  it("AC: single-zone household (one Sonos Move) succeeds", async () => {
    const { wrapper, mockSd } = await mountPi();
    sonosControllerImpl.getDevices.mockResolvedValue([
      {
        uuid: "RINCON_move",
        primary: true,
        hostAddress: "192.168.1.50",
        port: 1400,
        zoneName: "Move",
        isSatellite: false,
        idleState: "ACTIVE",
      },
    ]);
    sonosControllerImpl.getFavorites.mockResolvedValue([]);

    await wrapper
      .find("[data-pi-primary-device-address]")
      .setValue("192.168.1.50");
    await wrapper.vm.saveAndConnect();
    await nextTick();

    expect(mockSd.saveGlobalSettings).toHaveBeenCalledTimes(1);
    const persisted = mockSd.saveGlobalSettings.mock.calls[0][0].payload;
    expect(Object.keys(persisted.devices)).toEqual(["RINCON_move"]);
    expect(persisted.devices.RINCON_move.primary).toBe(true);
    expect(wrapper.vm.errorMessage).toBe(null);
    expect(wrapper.vm.connectionState).toBe("CONNECTED");
  });

  it("AC: stereo-pair household (one member + one satellite) succeeds; satellite gets isSatellite=true", async () => {
    const { wrapper, mockSd } = await mountPi();
    sonosControllerImpl.getDevices.mockResolvedValue([
      {
        uuid: "RINCON_left",
        primary: true,
        hostAddress: "192.168.1.51",
        port: 1400,
        zoneName: "Living Room",
        isSatellite: false,
        idleState: "ACTIVE",
      },
      {
        uuid: "RINCON_right",
        primary: false,
        hostAddress: "192.168.1.52",
        port: 1400,
        zoneName: "Living Room",
        isSatellite: true,
        idleState: "ACTIVE",
      },
    ]);
    sonosControllerImpl.getFavorites.mockResolvedValue([]);

    await wrapper
      .find("[data-pi-primary-device-address]")
      .setValue("192.168.1.51");
    await wrapper.vm.saveAndConnect();
    await nextTick();

    const persisted = mockSd.saveGlobalSettings.mock.calls[0][0].payload;
    expect(persisted.devices.RINCON_left.isSatellite).toBe(false);
    expect(persisted.devices.RINCON_right.isSatellite).toBe(true);
  });

  it("AC: home-theater household (soundbar + sub + 2 surrounds) succeeds; all members appear", async () => {
    const { wrapper, mockSd } = await mountPi();
    sonosControllerImpl.getDevices.mockResolvedValue([
      {
        uuid: "RINCON_arc",
        primary: true,
        hostAddress: "192.168.1.60",
        port: 1400,
        zoneName: "TV",
        isSatellite: false,
        idleState: "ACTIVE",
      },
      {
        uuid: "RINCON_sub",
        primary: false,
        hostAddress: "192.168.1.61",
        port: 1400,
        zoneName: "TV",
        isSatellite: true,
        idleState: "ACTIVE",
      },
      {
        uuid: "RINCON_left_surround",
        primary: false,
        hostAddress: "192.168.1.62",
        port: 1400,
        zoneName: "TV",
        isSatellite: true,
        idleState: "ACTIVE",
      },
      {
        uuid: "RINCON_right_surround",
        primary: false,
        hostAddress: "192.168.1.63",
        port: 1400,
        zoneName: "TV",
        isSatellite: true,
        idleState: "ACTIVE",
      },
    ]);
    sonosControllerImpl.getFavorites.mockResolvedValue([]);

    await wrapper
      .find("[data-pi-primary-device-address]")
      .setValue("192.168.1.60");
    await wrapper.vm.saveAndConnect();
    await nextTick();

    const persisted = mockSd.saveGlobalSettings.mock.calls[0][0].payload;
    expect(Object.keys(persisted.devices).sort()).toEqual([
      "RINCON_arc",
      "RINCON_left_surround",
      "RINCON_right_surround",
      "RINCON_sub",
    ]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Picker population
// ────────────────────────────────────────────────────────────────────────────

describe("Save and Connect — picker populates (orw.9 AC)", () => {
  it("AC: speakers picker populates after success", async () => {
    const { wrapper } = await mountPi();
    sonosControllerImpl.getDevices.mockResolvedValue([
      {
        uuid: "RINCON_office",
        primary: true,
        hostAddress: "192.168.1.42",
        port: 1400,
        zoneName: "Office",
        isSatellite: false,
        idleState: "ACTIVE",
      },
    ]);
    sonosControllerImpl.getFavorites.mockResolvedValue([]);

    await wrapper
      .find("[data-pi-primary-device-address]")
      .setValue("192.168.1.42");
    await wrapper.vm.saveAndConnect();
    await nextTick();

    expect(wrapper.vm.speakers).toHaveLength(1);
    expect(wrapper.vm.speakers[0].uuid).toBe("RINCON_office");
    expect(wrapper.vm.speakers[0].zoneName).toBe("Office");
    expect(wrapper.vm.speakers[0].isSatellite).toBe(false);

    // Picker should be visible (isConnected = true)
    expect(
      wrapper.find('[data-pi-section="sonos-speakers"] select').exists(),
    ).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Selected-speaker default
// ────────────────────────────────────────────────────────────────────────────

describe("Save and Connect — selected-speaker default (orw.9 AC)", () => {
  it("AC: brand-new action with no bound speaker defaults to discovery seed (primary) on connect success", async () => {
    const { wrapper, mockSd } = await mountPi();
    sonosControllerImpl.getDevices.mockResolvedValue([
      {
        uuid: "RINCON_seed",
        primary: true,
        hostAddress: "192.168.1.42",
        port: 1400,
        zoneName: "Office",
        isSatellite: false,
        idleState: "ACTIVE",
      },
      {
        uuid: "RINCON_other",
        primary: false,
        hostAddress: "192.168.1.43",
        port: 1400,
        zoneName: "Living Room",
        isSatellite: false,
        idleState: "ACTIVE",
      },
    ]);
    sonosControllerImpl.getFavorites.mockResolvedValue([]);

    await wrapper
      .find("[data-pi-primary-device-address]")
      .setValue("192.168.1.42");
    await wrapper.vm.saveAndConnect();
    await nextTick();

    // saveSettings should have been called with the seed device's UUID
    expect(mockSd.saveSettings).toHaveBeenCalled();
    const persistedAction =
      mockSd.saveSettings.mock.calls.at(-1)[0].actionSettings;
    expect(persistedAction.uuid).toBe("RINCON_seed");
    expect(persistedAction.zoneName).toBe("Office");
    expect(persistedAction.title).toBe("Office (192.168.1.42)");
  });

  it("does NOT clobber an already-bound speaker", async () => {
    const { wrapper, mockSd } = await mountPi();
    wrapper.vm.settings = {
      action: PREFIX + "toggle-mute-unmute",
      uuid: "RINCON_existing",
      zoneName: "Bedroom",
      hostAddress: "192.168.1.99",
    };
    await nextTick();

    sonosControllerImpl.getDevices.mockResolvedValue([
      {
        uuid: "RINCON_seed",
        primary: true,
        hostAddress: "192.168.1.42",
        port: 1400,
        zoneName: "Office",
        isSatellite: false,
        idleState: "ACTIVE",
      },
    ]);
    sonosControllerImpl.getFavorites.mockResolvedValue([]);

    await wrapper
      .find("[data-pi-primary-device-address]")
      .setValue("192.168.1.42");
    await wrapper.vm.saveAndConnect();
    await nextTick();

    // saveSettings was NOT called because uuid is already bound
    expect(mockSd.saveSettings).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Error path
// ────────────────────────────────────────────────────────────────────────────

describe("Save and Connect — error path (orw.9 AC)", () => {
  it("AC: timeout error → errorMessage set with exception .message; no saveGlobalSettings", async () => {
    const { wrapper, mockSd } = await mountPi();
    sonosControllerImpl.getDevices.mockRejectedValue(
      new Error(
        "Failed to get devices: Timeout while getting devices after 10 seconds",
      ),
    );
    sonosControllerImpl.getFavorites.mockResolvedValue([]);

    await wrapper
      .find("[data-pi-primary-device-address]")
      .setValue("192.168.1.42");
    await wrapper.vm.saveAndConnect();
    await nextTick();

    expect(wrapper.vm.errorMessage).toBe(
      "Failed to get devices: Timeout while getting devices after 10 seconds",
    );
    expect(mockSd.saveGlobalSettings).not.toHaveBeenCalled();
  });

  it("AC: error path resets isDiscovering (button is no longer disabled by spinner)", async () => {
    const { wrapper } = await mountPi();
    sonosControllerImpl.getDevices.mockRejectedValue(new Error("network down"));
    sonosControllerImpl.getFavorites.mockResolvedValue([]);

    await wrapper
      .find("[data-pi-primary-device-address]")
      .setValue("192.168.1.42");
    await wrapper.vm.saveAndConnect();
    await nextTick();

    expect(wrapper.vm.isDiscovering).toBe(false);
    expect(
      wrapper.find("[data-pi-save-and-connect-spinner]").exists(),
    ).toBe(false);
  });

  it("AC: connectionState stays !CONNECTED on error (button stays Save and Connect)", async () => {
    const { wrapper } = await mountPi();
    sonosControllerImpl.getDevices.mockRejectedValue(new Error("oops"));
    sonosControllerImpl.getFavorites.mockResolvedValue([]);

    await wrapper
      .find("[data-pi-primary-device-address]")
      .setValue("192.168.1.42");
    await wrapper.vm.saveAndConnect();
    await nextTick();

    expect(wrapper.vm.connectionState).not.toBe("CONNECTED");
    expect(wrapper.find("[data-pi-save-and-connect]").text().trim()).toBe(
      "Save and Connect",
    );
  });

  it("error alert renders with the error message inside the global settings accordion", async () => {
    const { wrapper } = await mountPi();
    sonosControllerImpl.getDevices.mockRejectedValue(new Error("Custom error"));
    sonosControllerImpl.getFavorites.mockResolvedValue([]);

    await wrapper
      .find("[data-pi-primary-device-address]")
      .setValue("192.168.1.42");
    await wrapper.vm.saveAndConnect();
    await nextTick();

    expect(wrapper.find("[data-pi-error-alert]").text()).toContain(
      "Custom error",
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Implementation invariants
// ────────────────────────────────────────────────────────────────────────────

describe("Save and Connect — internals (orw.9 Developer AC)", () => {
  it("AC: getDevices and getFavorites share the same SonosController instance", async () => {
    const { wrapper } = await mountPi();
    sonosControllerImpl.getDevices.mockResolvedValue([]);
    sonosControllerImpl.getFavorites.mockResolvedValue([]);

    await wrapper
      .find("[data-pi-primary-device-address]")
      .setValue("192.168.1.42");
    await wrapper.vm.saveAndConnect();
    await nextTick();

    // SonosController constructor called exactly once for one click
    expect(SonosController).toHaveBeenCalledTimes(1);
    // Both methods called on the same shared mock
    expect(sonosControllerImpl.getDevices).toHaveBeenCalledTimes(1);
    expect(sonosControllerImpl.getFavorites).toHaveBeenCalledTimes(1);
  });

  it("AC: SonosController is constructed with timeoutSec from globalSettings", async () => {
    const { wrapper } = await mountPi();
    wrapper.vm.globalSettings = {
      deviceCheckInterval: 10,
      deviceTimeoutDuration: 7,
      adjustVolumeIncrement: 10,
    };
    await nextTick();
    sonosControllerImpl.getDevices.mockResolvedValue([]);
    sonosControllerImpl.getFavorites.mockResolvedValue([]);

    await wrapper
      .find("[data-pi-primary-device-address]")
      .setValue("192.168.1.42");
    await wrapper.vm.saveAndConnect();
    await nextTick();

    expect(SonosController).toHaveBeenCalledWith({ timeoutSec: 7 });
  });

  it("connect() is called with the trimmed primary device address", async () => {
    const { wrapper } = await mountPi();
    sonosControllerImpl.getDevices.mockResolvedValue([]);
    sonosControllerImpl.getFavorites.mockResolvedValue([]);

    await wrapper
      .find("[data-pi-primary-device-address]")
      .setValue("  192.168.1.42  ");
    await wrapper.vm.saveAndConnect();
    await nextTick();

    expect(sonosControllerImpl.connect).toHaveBeenCalledWith("192.168.1.42");
  });

  it("favorites array round-trips through saveGlobalSettings", async () => {
    const { wrapper, mockSd } = await mountPi();
    const FAVS = [
      {
        title: "Morning Mix",
        uri: "x-rincon-cpcontainer:m",
        metadata: "<DIDL/>",
        albumArtURI: "/m.jpg",
      },
    ];
    sonosControllerImpl.getDevices.mockResolvedValue([]);
    sonosControllerImpl.getFavorites.mockResolvedValue(FAVS);

    await wrapper
      .find("[data-pi-primary-device-address]")
      .setValue("192.168.1.42");
    await wrapper.vm.saveAndConnect();
    await nextTick();

    const persisted = mockSd.saveGlobalSettings.mock.calls[0][0].payload;
    expect(persisted.favorites).toEqual(FAVS);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Speaker selection via SonosSelection
// ────────────────────────────────────────────────────────────────────────────

describe("PiComponent — speaker selection (orw.3 + orw.9 integration)", () => {
  it("selecting a speaker via the picker calls saveSettings with the new uuid/title/host/zone", async () => {
    const { wrapper, mockSd } = await mountPi();
    sonosControllerImpl.getDevices.mockResolvedValue([
      {
        uuid: "RINCON_office",
        primary: true,
        hostAddress: "192.168.1.42",
        port: 1400,
        zoneName: "Office",
        isSatellite: false,
        idleState: "ACTIVE",
      },
      {
        uuid: "RINCON_living",
        primary: false,
        hostAddress: "192.168.1.43",
        port: 1400,
        zoneName: "Living Room",
        isSatellite: false,
        idleState: "ACTIVE",
      },
    ]);
    sonosControllerImpl.getFavorites.mockResolvedValue([]);

    await wrapper
      .find("[data-pi-primary-device-address]")
      .setValue("192.168.1.42");
    await wrapper.vm.saveAndConnect();
    await nextTick();

    mockSd.saveSettings.mockClear();
    wrapper.vm.onSpeakerSelected("RINCON_living");
    await nextTick();

    const persisted = mockSd.saveSettings.mock.calls.at(-1)[0].actionSettings;
    expect(persisted.uuid).toBe("RINCON_living");
    expect(persisted.zoneName).toBe("Living Room");
    expect(persisted.hostAddress).toBe("192.168.1.43");
    expect(persisted.title).toBe("Living Room (192.168.1.43)");
  });
});
