import { describe, it, expect } from "vitest";
import {
  buildGlobalSettingsPayload,
  clampVolumeIncrement,
} from "@/modules/pi/globalSettingsSchema.js";

describe("buildGlobalSettingsPayload — schema shape (orw.12 AC)", () => {
  it("writes exactly the 5 top-level keys (no extras, no missing)", () => {
    const payload = buildGlobalSettingsPayload({
      devices: {},
      deviceCheckInterval: 10,
      deviceTimeoutDuration: 10,
      adjustVolumeIncrement: 10,
      favorites: [],
    });
    expect(Object.keys(payload).sort()).toEqual([
      "adjustVolumeIncrement",
      "deviceCheckInterval",
      "deviceTimeoutDuration",
      "devices",
      "favorites",
    ]);
  });

  it("passes devices map through unchanged (caller owns DeviceRecord shape)", () => {
    const devices = {
      RINCON_a: {
        primary: true,
        hostAddress: "192.168.1.42",
        port: 1400,
        zoneName: "Office",
        isSatellite: false,
        idleState: "ACTIVE",
        uuid: "RINCON_a",
      },
      RINCON_b: {
        primary: false,
        hostAddress: "192.168.1.43",
        port: 1400,
        zoneName: "Living Room",
        isSatellite: false,
        idleState: "ACTIVE",
        uuid: "RINCON_b",
      },
    };
    const payload = buildGlobalSettingsPayload({
      devices,
      deviceCheckInterval: 10,
      deviceTimeoutDuration: 10,
      adjustVolumeIncrement: 10,
      favorites: [],
    });
    expect(payload.devices).toBe(devices);
  });

  it("passes favorites array through unchanged", () => {
    const favorites = [
      {
        title: "Morning Mix",
        uri: "x-rincon-cpcontainer:abc",
        metadata: "<DIDL-Lite/>",
        albumArtURI: "/getaa?u=...",
      },
    ];
    const payload = buildGlobalSettingsPayload({
      devices: {},
      deviceCheckInterval: 10,
      deviceTimeoutDuration: 10,
      adjustVolumeIncrement: 10,
      favorites,
    });
    expect(payload.favorites).toBe(favorites);
  });

  it("preserves deviceCheckInterval and deviceTimeoutDuration verbatim", () => {
    const payload = buildGlobalSettingsPayload({
      devices: {},
      deviceCheckInterval: 7,
      deviceTimeoutDuration: 12,
      adjustVolumeIncrement: 10,
      favorites: [],
    });
    expect(payload.deviceCheckInterval).toBe(7);
    expect(payload.deviceTimeoutDuration).toBe(12);
  });
});

describe("clampVolumeIncrement — Math.max(1, value) regression (orw.12 End User AC)", () => {
  it("clamps 0 to 1", () => {
    expect(clampVolumeIncrement(0)).toBe(1);
  });

  it("clamps -5 to 1", () => {
    expect(clampVolumeIncrement(-5)).toBe(1);
  });

  it("does not coerce 1 (valid floor)", () => {
    expect(clampVolumeIncrement(1)).toBe(1);
  });

  it("does not coerce 15 (above floor)", () => {
    expect(clampVolumeIncrement(15)).toBe(15);
  });

  it("clamps 0.5 to 1", () => {
    expect(clampVolumeIncrement(0.5)).toBe(1);
  });

  it("coerces numeric strings", () => {
    expect(clampVolumeIncrement("0")).toBe(1);
    expect(clampVolumeIncrement("15")).toBe(15);
  });

  it("returns 1 for non-numeric input (NaN, undefined)", () => {
    expect(clampVolumeIncrement(NaN)).toBe(1);
    expect(clampVolumeIncrement(undefined)).toBe(1);
    expect(clampVolumeIncrement("not a number")).toBe(1);
  });
});

describe("buildGlobalSettingsPayload — clamp applied to adjustVolumeIncrement", () => {
  it("clamps adjustVolumeIncrement = 0 → 1 in the persisted payload", () => {
    const payload = buildGlobalSettingsPayload({
      devices: {},
      deviceCheckInterval: 10,
      deviceTimeoutDuration: 10,
      adjustVolumeIncrement: 0,
      favorites: [],
    });
    expect(payload.adjustVolumeIncrement).toBe(1);
  });

  it("clamps adjustVolumeIncrement = -5 → 1 in the persisted payload", () => {
    const payload = buildGlobalSettingsPayload({
      devices: {},
      deviceCheckInterval: 10,
      deviceTimeoutDuration: 10,
      adjustVolumeIncrement: -5,
      favorites: [],
    });
    expect(payload.adjustVolumeIncrement).toBe(1);
  });

  it("preserves adjustVolumeIncrement = 1 unchanged", () => {
    const payload = buildGlobalSettingsPayload({
      devices: {},
      deviceCheckInterval: 10,
      deviceTimeoutDuration: 10,
      adjustVolumeIncrement: 1,
      favorites: [],
    });
    expect(payload.adjustVolumeIncrement).toBe(1);
  });

  it("preserves adjustVolumeIncrement = 15 unchanged", () => {
    const payload = buildGlobalSettingsPayload({
      devices: {},
      deviceCheckInterval: 10,
      deviceTimeoutDuration: 10,
      adjustVolumeIncrement: 15,
      favorites: [],
    });
    expect(payload.adjustVolumeIncrement).toBe(15);
  });
});
