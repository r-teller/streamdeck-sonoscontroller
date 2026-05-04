// XML → JSON helpers for Sonos UPnP responses.
// Single child of a given tag returns as a plain object/string; duplicate
// siblings collapse to an array. Pair with `asArray` at every iteration site
// (ZoneGroup, ZoneGroupMember, Satellite) to handle 1-element households
// without the "<name> is not iterable" failure mode called out in
// prd-what.md §3.3.
//
// Attributes are exposed under the `_attributes` key. Mixed text+element
// content stores the trimmed text under `_text`. Empty elements return "".

function convertNode(node) {
  switch (node.nodeType) {
    case 1: {
      const obj = {};

      if (node.attributes && node.attributes.length > 0) {
        obj._attributes = Object.fromEntries([...node.attributes].map((a) => [a.nodeName, a.nodeValue]));
      }

      let text = "";
      let hasElementChildren = false;

      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          text += child.nodeValue;
        } else if (child.nodeType === 4) {
          text += child.nodeValue;
        } else if (child.nodeType === 1) {
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
    case 3:
      return node.nodeValue.trim() || null;
    case 4:
      return node.nodeValue.trim() || null;
    case 9:
      return convertNode(node.documentElement);
    case 8:
    case 10:
    default:
      return null;
  }
}

export function convertXmlToJson(input) {
  if (typeof input === "string") {
    const doc = new DOMParser().parseFromString(input, "text/xml");
    return convertNode(doc);
  }
  return convertNode(input);
}

export function asArray(value) {
  return [].concat(value ?? []);
}
