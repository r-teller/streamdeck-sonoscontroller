// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

vi.mock("@/modules/common/sdConnect.js", () => ({
  streamDeckReady: new Promise(() => {}),
  installStreamDeckBridge: vi.fn(),
  getStreamDeckClient: vi.fn(() => null),
}));

import PiComponent from "@/components/PiComponent.vue";
import { encodeBase64Metadata } from "@/modules/pi/actionSettingsSchema.js";

const PREFIX = "com.r-teller.sonoscontroller.";
const baseInput = {
  action: PREFIX + "toggle-mute-unmute",
  states: [{ Name: "Unmuted" }, { Name: "Muted" }],
  controller: "Keypad",
  uuid: "RINCON_x",
  title: "Office (192.168.1.42)",
  hostAddress: "192.168.1.42",
  zoneName: "Office",
};

function makeMockSd(uuid = "context-abc") {
  return {
    uuid,
    saveSettings: vi.fn(),
    saveGlobalSettings: vi.fn(),
  };
}

describe("PiComponent.saveSettings — integration (orw.11)", () => {
  let wrapper;
  let mockSd;

  beforeEach(() => {
    mockSd = makeMockSd();
    wrapper = mount(PiComponent);
    wrapper.vm.sdClient = mockSd;
  });

  it("invokes sd.saveSettings with actionSettings + context", () => {
    wrapper.vm.saveSettings(baseInput);
    expect(mockSd.saveSettings).toHaveBeenCalledTimes(1);
    const call = mockSd.saveSettings.mock.calls[0][0];
    expect(call).toHaveProperty("actionSettings");
    expect(call).toHaveProperty("context", "context-abc");
  });

  it("toggle-mute-unmute with displayStateBasedTitle=true → persists schema correctly", () => {
    wrapper.vm.saveSettings({
      ...baseInput,
      displayStateBasedTitle: true,
    });
    const persisted = mockSd.saveSettings.mock.calls[0][0].actionSettings;
    expect(persisted.displayStateBasedTitle).toBe(true);
    expect(persisted.displayMarqueeTitle).toBe(null);
    expect(persisted.displayMarqueeAlbumTitle).toBe(null);
    expect(persisted.displayAlbumArt).toBe(null);
    expect(persisted.adjustVolumeIncrement).toBe(null);
  });

  it("PR #4 regression: volume-up with adjustVolumeIncrement=1 persists 1 (not null)", () => {
    wrapper.vm.saveSettings({
      ...baseInput,
      action: PREFIX + "volume-up",
      adjustVolumeIncrement: 1,
    });
    const persisted = mockSd.saveSettings.mock.calls[0][0].actionSettings;
    expect(persisted.adjustVolumeIncrement).toBe(1);
  });

  it("volume-up with empty override persists null", () => {
    wrapper.vm.saveSettings({
      ...baseInput,
      action: PREFIX + "volume-up",
      adjustVolumeIncrement: "",
    });
    const persisted = mockSd.saveSettings.mock.calls[0][0].actionSettings;
    expect(persisted.adjustVolumeIncrement).toBe(null);
  });

  it("play-sonos-favorite metadata round-trips base64 → UTF-8", () => {
    const xml =
      '<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="favorite-1"/></DIDL-Lite>';
    wrapper.vm.saveSettings({
      ...baseInput,
      action: PREFIX + "play-sonos-favorite",
      selectedSonosFavorite: {
        title: "Morning Mix",
        uri: "x-rincon-cpcontainer:abc",
        metadata: encodeBase64Metadata(xml),
        albumArtURI: "/getaa?u=x",
      },
    });
    const persisted = mockSd.saveSettings.mock.calls[0][0].actionSettings;
    expect(persisted.selectedSonosFavorite.metadata).toBe(xml);
  });

  it("updates local settings ref to the persisted payload", () => {
    wrapper.vm.saveSettings({
      ...baseInput,
      action: PREFIX + "volume-up",
      adjustVolumeIncrement: 7,
    });
    expect(wrapper.vm.settings.adjustVolumeIncrement).toBe(7);
    expect(wrapper.vm.settings.action).toBe(PREFIX + "volume-up");
  });

  it("returns null and does not throw when sdClient is unset", () => {
    wrapper.vm.sdClient = null;
    const result = wrapper.vm.saveSettings(baseInput);
    expect(result).toBe(null);
    expect(mockSd.saveSettings).not.toHaveBeenCalled();
  });
});
