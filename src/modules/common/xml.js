// XML → JSON helpers for Sonos UPnP responses.
//
// Single child of a given tag returns as a plain object/string; duplicate
// siblings collapse to an array. Pair with `asArray` at every iteration site
// (ZoneGroup, ZoneGroupMember, Satellite) to handle 1-element households
// without the "<name> is not iterable" failure mode called out in
// prd-what.md §3.3.
//
// Shapes returned for a single element:
//   - text-only, no attrs       → string  (e.g., "1")
//   - empty element, no attrs   → ""      (consumers must not throw on empty)
//   - has attrs and/or children → object  ({ _attributes?, _text?, ...kids })
//
// Attributes are exposed under the `_attributes` key. Mixed text+element
// content stores the trimmed text under `_text`. Comments and DOCTYPE nodes
// are dropped.
//
// Throws `XmlParseError` if the input string is not well-formed XML.

export class XmlParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "XmlParseError";
  }
}

const NODE_ELEMENT = 1;
const NODE_TEXT = 3;
const NODE_CDATA = 4;
const NODE_DOCUMENT = 9;

function convertNode(node) {
  switch (node.nodeType) {
    case NODE_ELEMENT: {
      const obj = {};

      if (node.attributes && node.attributes.length > 0) {
        obj._attributes = Object.fromEntries([...node.attributes].map((a) => [a.nodeName, a.nodeValue]));
      }

      let text = "";
      let hasElementChildren = false;

      for (const child of node.childNodes) {
        if (child.nodeType === NODE_TEXT || child.nodeType === NODE_CDATA) {
          text += child.nodeValue;
        } else if (child.nodeType === NODE_ELEMENT) {
          hasElementChildren = true;
          const name = child.nodeName;
          const value = convertNode(child);
          if (value === null) continue;
          if (name in obj) {
            if (!Array.isArray(obj[name])) obj[name] = [obj[name]];
            obj[name].push(value);
          } else {
            obj[name] = value;
          }
        }
      }

      const trimmed = text.trim();

      if (!hasElementChildren && Object.keys(obj).length === 0) {
        return trimmed;
      }
      if (trimmed) obj._text = trimmed;
      return obj;
    }
    case NODE_TEXT:
    case NODE_CDATA:
      return node.nodeValue.trim() || null;
    case NODE_DOCUMENT:
      return convertNode(node.documentElement);
    default:
      return null;
  }
}

/**
 * Parse XML into a plain JS object. Accepts either a raw XML string or an
 * already-parsed Document/Node. Throws `XmlParseError` on malformed input.
 */
export function convertXmlToJson(input) {
  if (typeof input === "string") {
    const doc = new DOMParser().parseFromString(input, "text/xml");
    const errors = doc.getElementsByTagName("parsererror");
    if (errors.length > 0) {
      throw new XmlParseError(errors[0].textContent.trim() || "Malformed XML");
    }
    return convertNode(doc);
  }
  return convertNode(input);
}

/**
 * Coerce `value` into an array. Use at every iteration site (ZoneGroup,
 * ZoneGroupMember, Satellite, etc.) so single-child households don't throw
 * `<name> is not iterable`. Empty / nullish input returns `[]`.
 */
export function asArray(value) {
  return [].concat(value ?? []);
}
