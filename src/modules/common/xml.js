export class XmlParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "XmlParseError";
  }
}

function parseXml(input) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(input, "text/xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    const errorText = parserError.textContent?.trim() || "XML parse error";
    throw new XmlParseError(errorText);
  }
  return doc;
}

function elementToJson(element) {
  const result = {};
  const attributes = element.attributes;
  const hasAttributes = attributes.length > 0;

  if (hasAttributes) {
    const attrObj = {};
    for (let i = 0; i < attributes.length; i++) {
      const attr = attributes[i];
      attrObj[attr.name] = attr.value;
    }
    result._attributes = attrObj;
  }

  let textContent = "";
  let childElements = [];

  for (let i = 0; i < element.childNodes.length; i++) {
    const node = element.childNodes[i];
    if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) {
      textContent += node.nodeValue;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      childElements.push(node);
    }
    // Comments and DOCTYPE are dropped
  }

  const trimmedText = textContent.trim();

  if (childElements.length === 0) {
    if (hasAttributes) {
      if (trimmedText !== "") {
        result._text = trimmedText;
      }
      return result;
    }
    return trimmedText;
  }

  for (let i = 0; i < childElements.length; i++) {
    const child = childElements[i];
    const tag = child.tagName;
    const value = elementToJson(child);

    if (result[tag] === undefined) {
      result[tag] = value;
    } else if (Array.isArray(result[tag])) {
      result[tag].push(value);
    } else {
      result[tag] = [result[tag], value];
    }
  }

  if (trimmedText !== "") {
    result._text = trimmedText;
  }

  return result;
}

export function convertXmlToJson(input) {
  if (typeof input !== "string") {
    throw new XmlParseError("Input must be a string");
  }

  const doc = parseXml(input);
  const root = doc.documentElement;
  return elementToJson(root);
}

export function asArray(value) {
  return [].concat(value ?? []);
}

export function extractText(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    return value._text ?? "";
  }
  return "";
}
