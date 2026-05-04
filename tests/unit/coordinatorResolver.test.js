// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { resolveCoordinator } from "@/modules/common/coordinatorResolver.js";
import { convertXmlToJson } from "@/modules/common/xml.js";

// Helper: load a SOAP envelope fixture, drill into <ZoneGroupState>, and
// reparse the inner topology XML — the same path getZoneGroupState() takes at
// runtime (sonosController.js:65-76).
const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/sonos");
function loadTopology(fixtureName) {
  const envelopeXml = readFileSync(resolve(FIXTURES, fixtureName), "utf8");
  const envelope = convertXmlToJson(envelopeXml);
  // After parsing the SOAP envelope, ZoneGroupState arrives as a plain
  // string (already once-unescaped) ready for the second parse.
  const stateXml = envelope?.["s:Body"]?.["u:GetZoneGroupStateResponse"]?.ZoneGroupState ?? "";
  return convertXmlToJson(stateXml);
}

describe("resolveCoordinator — single-group, single-member household (Q1 trivial)", () => {
  const topology = loadTopology("zonegroupstate-single-group-single-member.xml");

  it("self-coord: bound speaker IS the only member → returns own UUID", () => {
    expect(resolveCoordinator("RINCON_OFFICE01400", topology)).toBe("RINCON_OFFICE01400");
  });
});

describe("resolveCoordinator — multi-group household (Q1 main case)", () => {
  const topology = loadTopology("zonegroupstate-multi-group.xml");

  it("self-coord member of solo group: Office → Office", () => {
    expect(resolveCoordinator("RINCON_OFFICE01400", topology)).toBe("RINCON_OFFICE01400");
  });

  it("self-coord member of multi-member group: Kitchen → Kitchen", () => {
    expect(resolveCoordinator("RINCON_KITCHEN01400", topology)).toBe("RINCON_KITCHEN01400");
  });

  it("non-coord member: Dining Room → Kitchen (Kitchen's group's coord)", () => {
    expect(resolveCoordinator("RINCON_DININGROOM01400", topology)).toBe("RINCON_KITCHEN01400");
  });

  it("self-coord of last group: Patio → Patio", () => {
    expect(resolveCoordinator("RINCON_PATIO01400", topology)).toBe("RINCON_PATIO01400");
  });
});

describe("resolveCoordinator — stereo-pair satellite (Q4)", () => {
  const topology = loadTopology("zonegroupstate-stereo-pair.xml");

  it("primary: Bedroom → Bedroom", () => {
    expect(resolveCoordinator("RINCON_BEDROOM01400", topology)).toBe("RINCON_BEDROOM01400");
  });

  it("satellite: Bedroom satellite → Bedroom primary", () => {
    expect(resolveCoordinator("RINCON_BEDROOM01401", topology)).toBe("RINCON_BEDROOM01400");
  });
});

describe("resolveCoordinator — home-theater with three satellites (Q4 variant)", () => {
  const topology = loadTopology("zonegroupstate-home-theater.xml");

  it("primary: Living Room → Living Room", () => {
    expect(resolveCoordinator("RINCON_LIVINGROOM01400", topology)).toBe("RINCON_LIVINGROOM01400");
  });

  it.each([
    ["RINCON_LIVINGROOM01401"],
    ["RINCON_LIVINGROOM01402"],
    ["RINCON_LIVINGROOM01403"],
  ])("satellite %s → Living Room primary", (uuid) => {
    expect(resolveCoordinator(uuid, topology)).toBe("RINCON_LIVINGROOM01400");
  });
});

describe("resolveCoordinator — live capture: home theater (3 satellites) + grouped sibling room (cel spike validation)", () => {
  // Sanitized capture from a real S2 household (firmware 86.6-75110, ZPS9).
  // Topology shape:
  //   Group 1 (LIVINGROOMBAR coord)
  //     ├─ LIVINGROOMBAR (soundbar, coord)
  //     │    ├─ Satellite LIVINGROOMSUB             (sub, :SW)
  //     │    ├─ Satellite LIVINGROOMSURROUNDLEFT    (left surround, :LR)
  //     │    └─ Satellite LIVINGROOMSURROUNDRIGHT   (right surround, :RR)
  //     └─ BEDROOM (separate room, grouped — NOT bonded)
  //   Group 2 (OFFICE coord)
  //     └─ OFFICE solo
  const topology = loadTopology("zonegroupstate-live-bonded-and-grouped.xml");

  it("self-coord: LIVINGROOMBAR → LIVINGROOMBAR", () => {
    expect(resolveCoordinator("RINCON_LIVINGROOMBAR01400", topology)).toBe(
      "RINCON_LIVINGROOMBAR01400",
    );
  });

  it.each([
    ["RINCON_LIVINGROOMSUB01400", "subwoofer (satellite[0])"],
    ["RINCON_LIVINGROOMSURROUNDLEFT01400", "left surround (satellite[1])"],
    ["RINCON_LIVINGROOMSURROUNDRIGHT01400", "right surround (satellite[2])"],
  ])("bonded satellite %s (%s) → LIVINGROOMBAR", (uuid) => {
    expect(resolveCoordinator(uuid, topology)).toBe("RINCON_LIVINGROOMBAR01400");
  });

  it("grouped non-coord room (the multi-group routing case): BEDROOM → LIVINGROOMBAR", () => {
    expect(resolveCoordinator("RINCON_BEDROOM01400", topology)).toBe(
      "RINCON_LIVINGROOMBAR01400",
    );
  });

  it("self-coord of separate group: OFFICE → OFFICE", () => {
    expect(resolveCoordinator("RINCON_OFFICE01400", topology)).toBe("RINCON_OFFICE01400");
  });
});

describe("resolveCoordinator — edge case contracts (Q2)", () => {
  const topology = loadTopology("zonegroupstate-multi-group.xml");

  it("Q2: speaker UUID not present in any group → throws SonosError with diagnostic message", () => {
    expect(() => resolveCoordinator("RINCON_GHOST01400", topology)).toThrow(
      /Bound speaker RINCON_GHOST01400 not found in current ZoneGroupTopology/,
    );
  });

  it("Q2: thrown error has SonosError shape (category=unknown) for translateSonosError compatibility", () => {
    try {
      resolveCoordinator("RINCON_GHOST01400", topology);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err.name).toBe("SonosError");
      expect(err.category).toBe("unknown");
    }
  });

  it("programmer guard: empty speakerUuid throws", () => {
    expect(() => resolveCoordinator("", topology)).toThrow(/speakerUuid is required/);
  });

  it("programmer guard: missing topology throws", () => {
    expect(() => resolveCoordinator("RINCON_OFFICE01400", null)).toThrow(/topology is required/);
  });
});
