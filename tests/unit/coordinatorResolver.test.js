// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach } from "vitest";
import { resolveCoordinator } from "@/modules/common/coordinatorResolver.js";
import { convertXmlToJson } from "@/modules/common/xml.js";
import { asArray } from "@/modules/common/xml.js";
import { SonosError } from "@/modules/common/sonosErrors.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixture = (name) => readFileSync(join(process.cwd(), "tests/fixtures/sonos", name), "utf8");

// Helper to extract the ZoneGroupState JSON from a SOAP envelope fixture
function topologyFrom(name) {
  const soap = convertXmlToJson(fixture(name));
  // The SOAP body wrapper is under s:Body → u:GetZoneGroupStateResponse → ZoneGroupState
  const body = soap["s:Body"] ?? soap.Body;
  const response = body?.["u:GetZoneGroupStateResponse"];
  const zgs = response?.ZoneGroupState;
  const innerXml = typeof zgs === "string" ? zgs : zgs?._text ?? "";
  return convertXmlToJson(innerXml);
}

describe("resolveCoordinator", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("missing arguments throw plain Error", () => {
    const topo = topologyFrom("zonegroupstate-single-group-single-member.xml");
    expect(() => resolveCoordinator(null, topo)).toThrow(Error);
    expect(() => resolveCoordinator("some-uuid", null)).toThrow(Error);
  });

  test("absent UUID throws SonosError with category 'unknown'", () => {
    const topo = topologyFrom("zonegroupstate-single-group-single-member.xml");
    let caught;
    try {
      resolveCoordinator("RINCON_NOPE", topo);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SonosError);
    expect(caught.category).toBe("unknown");
    expect(caught.message).toBe("Bound speaker RINCON_NOPE not found in current ZoneGroupTopology");
  });

  test("self‑coordinator returns its own UUID (home‑theater fixture)", () => {
    const topo = topologyFrom("zonegroupstate-home-theater.xml");
    const groups = asArray(topo.ZoneGroups?.ZoneGroup);
    const group = groups[0];
    const coordinatorUuid = group._attributes?.Coordinator;
    expect(resolveCoordinator(coordinatorUuid, topo)).toBe(coordinatorUuid);
  });

  test("grouped non‑coordinator returns group coordinator (multi‑group fixture)", () => {
    const topo = topologyFrom("zonegroupstate-multi-group.xml");
    const groups = asArray(topo.ZoneGroups?.ZoneGroup);
    // Find a member that is NOT the coordinator
    let nonCoordinatorUuid, expectedCoordinator;
    for (const g of groups) {
      const coord = g._attributes?.Coordinator;
      const members = asArray(g.ZoneGroupMember);
      for (const m of members) {
        const uuid = m._attributes?.UUID;
        if (uuid && uuid !== coord) {
          nonCoordinatorUuid = uuid;
          expectedCoordinator = coord;
          break;
        }
      }
      if (nonCoordinatorUuid) break;
    }
    expect(nonCoordinatorUuid).toBeTruthy();
    expect(resolveCoordinator(nonCoordinatorUuid, topo)).toBe(expectedCoordinator);
  });

  test("bonded satellite returns its group's coordinator (home‑theater fixture)", () => {
    const topo = topologyFrom("zonegroupstate-home-theater.xml");
    const groups = asArray(topo.ZoneGroups?.ZoneGroup);
    const group = groups[0];
    const coordinatorUuid = group._attributes?.Coordinator;
    const members = asArray(group.ZoneGroupMember);
    // Find a satellite under the first member
    let satelliteUuid;
    for (const m of members) {
      const satellites = asArray(m.Satellite);
      if (satellites.length) {
        satelliteUuid = satellites[0]?._attributes?.UUID;
        break;
      }
    }
    expect(satelliteUuid).toBeTruthy();
    expect(resolveCoordinator(satelliteUuid, topo)).toBe(coordinatorUuid);
  });

  test("live capture fixture resolves all satellites correctly", () => {
    const topo = topologyFrom("zonegroupstate-live-bonded-and-grouped.xml");
    const groups = asArray(topo.ZoneGroups?.ZoneGroup);
    const satellites = [];

    for (const g of groups) {
      const coord = g._attributes?.Coordinator;
      const members = asArray(g.ZoneGroupMember);
      for (const m of members) {
        const sats = asArray(m.Satellite);
        for (const sat of sats) {
          const satUuid = sat?._attributes?.UUID;
          if (satUuid) {
            satellites.push({ satUuid, coord });
          }
        }
      }
    }

    expect(satellites.length).toBeGreaterThan(0);
    for (const { satUuid, coord } of satellites) {
      expect(resolveCoordinator(satUuid, topo)).toBe(coord);
    }
  });
});
