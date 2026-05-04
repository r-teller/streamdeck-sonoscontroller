// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { convertXmlToJson, asArray, XmlParseError } from "@/modules/common/xml.js";

describe("convertXmlToJson — single-child vs sibling shape", () => {
  it("returns single child as a string, not a one-element array", () => {
    expect(convertXmlToJson("<r><a>1</a></r>")).toEqual({ a: "1" });
  });

  it("collapses two siblings sharing a tag into an array", () => {
    expect(convertXmlToJson("<r><a>1</a><a>2</a></r>")).toEqual({ a: ["1", "2"] });
  });

  it("keeps distinct sibling tags as separate object keys", () => {
    expect(convertXmlToJson("<r><a>1</a><b>2</b></r>")).toEqual({ a: "1", b: "2" });
  });

  it("round-trips CDATA content as a plain string with boundaries stripped", () => {
    const result = convertXmlToJson("<r><a><![CDATA[<b>raw</b>]]></a></r>");
    expect(result.a).toBe("<b>raw</b>");
  });

  it("returns empty string for an empty element (consumers must not throw)", () => {
    const result = convertXmlToJson("<r><a/></r>");
    expect(result.a).toBe("");
  });

  it("exposes attributes under _attributes", () => {
    const result = convertXmlToJson('<r><a id="x" name="y">1</a></r>');
    expect(result.a).toEqual({ _attributes: { id: "x", name: "y" }, _text: "1" });
  });
});

describe("convertXmlToJson — Sonos GetZoneGroupState shape", () => {
  it("single-zone-group household: ZoneGroup is an object, not a one-element array", () => {
    const xml = `
      <ZoneGroupTopology>
        <ZoneGroupState>
          <ZoneGroups>
            <ZoneGroup Coordinator="RINCON_X" ID="g1">
              <ZoneGroupMember UUID="m1" ZoneName="Office"/>
            </ZoneGroup>
          </ZoneGroups>
        </ZoneGroupState>
      </ZoneGroupTopology>`;
    const result = convertXmlToJson(xml);
    expect(Array.isArray(result.ZoneGroupState.ZoneGroups.ZoneGroup)).toBe(false);
    expect(result.ZoneGroupState.ZoneGroups.ZoneGroup._attributes.Coordinator).toBe("RINCON_X");
  });

  it("multi-zone-group household: ZoneGroup is an array of length >= 2", () => {
    const xml = `
      <ZoneGroupTopology>
        <ZoneGroupState>
          <ZoneGroups>
            <ZoneGroup Coordinator="A" ID="g1"/>
            <ZoneGroup Coordinator="B" ID="g2"/>
            <ZoneGroup Coordinator="C" ID="g3"/>
          </ZoneGroups>
        </ZoneGroupState>
      </ZoneGroupTopology>`;
    const result = convertXmlToJson(xml);
    expect(Array.isArray(result.ZoneGroupState.ZoneGroups.ZoneGroup)).toBe(true);
    expect(result.ZoneGroupState.ZoneGroups.ZoneGroup).toHaveLength(3);
  });
});

describe("convertXmlToJson — error handling", () => {
  it("throws XmlParseError on malformed XML", () => {
    expect(() => convertXmlToJson("<not closed")).toThrow(XmlParseError);
  });

  it("error message is non-empty so callers can surface it", () => {
    try {
      convertXmlToJson("<a><b></a>");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(XmlParseError);
      expect(err.message.length).toBeGreaterThan(0);
    }
  });
});

describe("asArray — defensive iteration helper", () => {
  it.each([
    [undefined, []],
    [null, []],
    ["foo", ["foo"]],
    [{ a: 1 }, [{ a: 1 }]],
    [
      [{ a: 1 }, { b: 2 }],
      [{ a: 1 }, { b: 2 }],
    ],
  ])("asArray(%j) → %j", (input, expected) => {
    expect(asArray(input)).toEqual(expected);
  });

  it("does NOT wrap the falsy-but-real value 0 as []", () => {
    expect(asArray(0)).toEqual([0]);
  });

  it("does NOT wrap empty string as []", () => {
    expect(asArray("")).toEqual([""]);
  });
});

describe("asArray — interop with convertXmlToJson normalization", () => {
  it("iterates uniformly across single-group and multi-group fixtures", () => {
    const single = convertXmlToJson(
      "<ZoneGroupTopology><ZoneGroupState><ZoneGroups><ZoneGroup ID='g1'/></ZoneGroups></ZoneGroupState></ZoneGroupTopology>",
    );
    const multi = convertXmlToJson(
      "<ZoneGroupTopology><ZoneGroupState><ZoneGroups><ZoneGroup ID='g1'/><ZoneGroup ID='g2'/></ZoneGroups></ZoneGroupState></ZoneGroupTopology>",
    );
    const collect = (parsed) => asArray(parsed.ZoneGroupState.ZoneGroups.ZoneGroup).map((g) => g._attributes.ID);
    expect(collect(single)).toEqual(["g1"]);
    expect(collect(multi)).toEqual(["g1", "g2"]);
  });
});
