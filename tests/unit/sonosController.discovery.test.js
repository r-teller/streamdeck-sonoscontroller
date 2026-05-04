// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { SonosController } from "@/modules/common/sonosController.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/sonos");
const fixture = (name) => readFileSync(resolve(FIXTURES, name), "utf8");

const okResponse = (body) =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
  });

function withFixture(name) {
  vi.stubGlobal("fetch", vi.fn(() => okResponse(fixture(name))));
}

describe("getDevices — single-group, single-member household (PR #3 regression, AC#1)", () => {
  it("returns an array of length 1, no 'is not iterable'", async () => {
    withFixture("zonegroupstate-single-group-single-member.xml");
    const c = new SonosController().connect("192.168.1.42");
    const devices = await c.getDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      hostAddress: "192.168.1.42",
      port: 1400,
      zoneName: "Office",
      isSatellite: false,
      idleState: "ACTIVE",
      uuid: "RINCON_OFFICE01400",
    });
  });
});

describe("getDevices — stereo pair (AC#2)", () => {
  it("returns 2 records: 1 main + 1 satellite", async () => {
    withFixture("zonegroupstate-stereo-pair.xml");
    const c = new SonosController().connect("192.168.1.50");
    const devices = await c.getDevices();
    expect(devices).toHaveLength(2);
    const satellites = devices.filter((d) => d.isSatellite);
    expect(satellites).toHaveLength(1);
    expect(satellites[0].hostAddress).toBe("192.168.1.51");
    expect(satellites[0].uuid).toBe("RINCON_BEDROOM01401");
  });
});

describe("getDevices — home theater group (AC#3)", () => {
  it("returns 4 records: 1 main + 3 satellites", async () => {
    withFixture("zonegroupstate-home-theater.xml");
    const c = new SonosController().connect("192.168.1.60");
    const devices = await c.getDevices();
    expect(devices).toHaveLength(4);
    expect(devices.filter((d) => d.isSatellite)).toHaveLength(3);
    expect(devices.filter((d) => !d.isSatellite)).toHaveLength(1);
    const mains = devices.filter((d) => !d.isSatellite);
    expect(mains[0].uuid).toBe("RINCON_LIVINGROOM01400");
  });
});

describe("getDevices — multi-group household (AC#4)", () => {
  it("returns every member from every group exactly once", async () => {
    withFixture("zonegroupstate-multi-group.xml");
    const c = new SonosController().connect("192.168.1.42");
    const devices = await c.getDevices();
    expect(devices).toHaveLength(4); // Office + Kitchen + Dining Room + Patio
    const uuids = devices.map((d) => d.uuid).sort();
    expect(uuids).toEqual([
      "RINCON_DININGROOM01400",
      "RINCON_KITCHEN01400",
      "RINCON_OFFICE01400",
      "RINCON_PATIO01400",
    ]);
  });
});

describe("getDevices — primary marking (AC#5)", () => {
  beforeEach(() => withFixture("zonegroupstate-multi-group.xml"));

  it("setAsPrimary: true marks exactly the matching host's record", async () => {
    const c = new SonosController().connect("192.168.1.43"); // Kitchen
    const devices = await c.getDevices({ setAsPrimary: true });
    const primaries = devices.filter((d) => d.primary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].hostAddress).toBe("192.168.1.43");
    expect(primaries[0].zoneName).toBe("Kitchen");
  });

  it("setAsPrimary omitted leaves no record primary", async () => {
    const c = new SonosController().connect("192.168.1.43");
    const devices = await c.getDevices();
    expect(devices.every((d) => d.primary === false)).toBe(true);
  });

  it("setAsPrimary: false leaves no record primary", async () => {
    const c = new SonosController().connect("192.168.1.43");
    const devices = await c.getDevices({ setAsPrimary: false });
    expect(devices.every((d) => d.primary === false)).toBe(true);
  });
});

describe("getDevices — UUID stability (AC#6)", () => {
  it("preserves the RINCON_xxxxxxxxxxxx01400 identifier verbatim", async () => {
    withFixture("zonegroupstate-stereo-pair.xml");
    const c = new SonosController().connect("192.168.1.50");
    const devices = await c.getDevices();
    expect(devices.every((d) => /^RINCON_[A-Z0-9]+01400|^RINCON_[A-Z0-9]+01401/.test(d.uuid))).toBe(true);
  });
});

describe("getDevices — boundary translation (AC#7)", () => {
  it("network failure rejects with 'Failed to get devices: Could not reach <host>:<port>'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );
    const c = new SonosController().connect("192.168.1.42");
    const err = await c.getDevices().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Failed to get devices: Could not reach 192.168.1.42:1400");
    expect(err.message).not.toMatch(/TypeError|fetch failed/);
  });

  it("bad response shape (PR #3 safety net) rejects with translated 'Unexpected response shape'", async () => {
    // Stub the topology to bypass network and inject a TypeError mid-walk.
    withFixture("zonegroupstate-multi-group.xml");
    const c = new SonosController().connect("192.168.1.42");
    // Sabotage _memberToRecord to throw the regression-class TypeError.
    c._memberToRecord = () => {
      throw new TypeError("ZoneGroupMember is not iterable");
    };
    const err = await c.getDevices().catch((e) => e);
    expect(err.message).toBe("Failed to get devices: Unexpected response shape from 192.168.1.42:1400");
    expect(err.message).not.toMatch(/TypeError|is not iterable/);
  });
});

describe("getDeviceLocation — host extraction", () => {
  it("extracts IP from a standard Location URL", () => {
    const member = { _attributes: { Location: "http://192.168.1.42:1400/xml/device_description.xml" } };
    expect(SonosController.getDeviceLocation(member)).toBe("192.168.1.42");
  });

  it("supports hostnames", () => {
    const member = { _attributes: { Location: "http://office.local:1400/xml/foo" } };
    expect(SonosController.getDeviceLocation(member)).toBe("office.local");
  });

  it("returns '' for a member with no Location", () => {
    expect(SonosController.getDeviceLocation({ _attributes: {} })).toBe("");
    expect(SonosController.getDeviceLocation({})).toBe("");
    expect(SonosController.getDeviceLocation(null)).toBe("");
  });
});
