// @vitest-environment jsdom
import { expect, test } from "vitest";
import { convertXmlToJson, asArray, XmlParseError } from "@/modules/common/xml.js";

test("single child collapse", () => {
  const xml = "<r><a>1</a></r>";
  expect(convertXmlToJson(xml)).toEqual({ a: "1" });
});

test("repeated tags become array", () => {
  const xml = "<r><a>1</a><a>2</a></r>";
  expect(convertXmlToJson(xml)).toEqual({ a: ["1", "2"] });
});

test("attributes are stored under _attributes", () => {
  const xml = '<r a="1" b="2"/>';
  expect(convertXmlToJson(xml)).toEqual({ _attributes: { a: "1", b: "2" } });
});

test("attributes with text produce _attributes and _text", () => {
  const xml = '<r a="1">hello</r>';
  expect(convertXmlToJson(xml)).toEqual({
    _attributes: { a: "1" },
    _text: "hello",
  });
});

test("CDATA is preserved verbatim", () => {
  const xml = "<r><![CDATA[<test>]]></r>";
  expect(convertXmlToJson(xml)).toBe("<test>");
});

test("parsererror throws XmlParseError", () => {
  const bad = "<r><a></r>";
  expect(() => convertXmlToJson(bad)).toThrowError(XmlParseError);
});

test("asArray handles various inputs", () => {
  expect(asArray(null)).toEqual([]);
  expect(asArray(undefined)).toEqual([]);
  expect(asArray([1, 2])).toEqual([1, 2]); // shallow copy
  expect(asArray(0)).toEqual([0]);
  expect(asArray("")).toEqual([""]);
  expect(asArray("x")).toEqual(["x"]);
});
