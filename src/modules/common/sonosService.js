// SOAP transport for a single Sonos UPnP service. One instance per
// (host, service) pair; SonosController (h75.2) constructs six per speaker.
//
// Every higher-level Sonos call funnels through `execute()`. This module owns
// the wire format and the timeout/abort lifecycle. Failures throw categorized
// `SonosError` instances; the boundary translator (sonosErrors.js) turns those
// into per-op user-facing messages. Programmer artifacts (TypeError,
// "fetch failed", "is not iterable") never bubble past `execute()`.

import { SonosError } from "@/modules/common/sonosErrors.js";

const SOAP_ENVELOPE_NS = "http://schemas.xmlsoap.org/soap/envelope/";
const DEFAULT_TIMEOUT_MS = 10_000;

const XML_ESCAPE_MAP = {
  "<": "&lt;",
  ">": "&gt;",
  "&": "&amp;",
  '"': "&quot;",
  "'": "&apos;",
};

function xmlEscape(value) {
  return String(value).replace(/[<>&"']/g, (c) => XML_ESCAPE_MAP[c]);
}

function buildEnvelope(name, action, args) {
  const argsXml = Object.entries(args ?? {})
    .map(([key, value]) => `<${key}>${xmlEscape(value)}</${key}>`)
    .join("");
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    `<s:Envelope xmlns:s="${SOAP_ENVELOPE_NS}" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
    "<s:Body>" +
    `<u:${action} xmlns:u="urn:schemas-upnp-org:service:${name}:1">${argsXml}</u:${action}>` +
    "</s:Body>" +
    "</s:Envelope>"
  );
}

/**
 * Parse a UPnP SOAP response body into `{fieldName: textContent}`. Walks
 * `s:Envelope > s:Body > <ActionResponse> > <field>` and reads textContent of
 * each field. Empty / no-children body → `{}`. Throws on malformed XML.
 */
export function parseResponseBody(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  if (doc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("Malformed XML response");
  }
  const body = findBodyElement(doc);
  if (!body) return {};
  const responseEl = Array.from(body.childNodes).find((n) => n.nodeType === 1);
  if (!responseEl) return {};
  const result = {};
  for (const child of responseEl.childNodes) {
    if (child.nodeType === 1) {
      result[child.nodeName] = child.textContent ?? "";
    }
  }
  return result;
}

function findBodyElement(doc) {
  return (
    doc.getElementsByTagNameNS(SOAP_ENVELOPE_NS, "Body")[0] ||
    doc.getElementsByTagName("s:Body")[0] ||
    doc.getElementsByTagName("Body")[0] ||
    null
  );
}

/**
 * Extract `{code, description}` from a UPnP SOAP fault response. Returns null
 * if the input doesn't look like a fault. Used to translate 5xx HTTP responses
 * into user-facing messages with the speaker's own error code surfaced.
 */
export function parseFault(xmlText) {
  try {
    const doc = new DOMParser().parseFromString(xmlText, "text/xml");
    if (doc.getElementsByTagName("parsererror").length > 0) return null;
    const codeEl = doc.getElementsByTagName("errorCode")[0];
    if (!codeEl) return null;
    const descEl = doc.getElementsByTagName("errorDescription")[0];
    return {
      code: codeEl.textContent?.trim() ?? "",
      description: descEl?.textContent?.trim() || "Unknown error",
    };
  } catch {
    return null;
  }
}

export class SonosService {
  /**
   * @param {object} opts
   * @param {string} opts.host — IPv4 or hostname of the Sonos speaker.
   * @param {string} opts.name — UPnP service name (e.g., "AVTransport").
   * @param {string} opts.baseUrl — URL prefix for this service
   *   (e.g., "MediaRenderer/AVTransport/Control"). Per backend.md §Service
   *   endpoints registered.
   * @param {number} [opts.port] — Defaults to 1400 (the only port Sonos uses).
   * @param {number} [opts.defaultTimeoutMs] — Fallback timeout for execute()
   *   calls that don't pass one. SonosController uses this to thread its
   *   timeoutSec into every service call without per-call boilerplate.
   */
  constructor({ host, name, baseUrl, port = 1400, defaultTimeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.host = host;
    this.port = port;
    this.name = name;
    this.baseUrl = baseUrl;
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  get url() {
    // baseUrl per backend.md §Service endpoints already includes the trailing
    // `/Control` segment (e.g. "MediaRenderer/AVTransport/Control").
    return `http://${this.host}:${this.port}/${this.baseUrl}`;
  }

  /**
   * POST a UPnP SOAP request and return the parsed response body.
   * Aborts the in-flight request on timeout (no socket leak).
   *
   * @param {string} action — e.g., "Play", "GetVolume", "GetZoneGroupState".
   * @param {Record<string, string|number>} [args] — Action arguments.
   *   Values are XML-escaped before insertion.
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs] — Default 10000 (per prd-what.md §6).
   * @returns {Promise<Record<string, string>>} Flat dict from the response
   *   body. All values are strings; numeric coercion is the caller's job.
   * @throws {Error} with a human-readable `.message` on any failure
   *   (timeout, network error, HTTP 5xx, malformed XML).
   */
  async execute(action, args = {}, { timeoutMs = this.defaultTimeoutMs } = {}) {
    const envelope = buildEnvelope(this.name, action, args);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(this.url, {
        method: "POST",
        headers: {
          SOAPAction: `"urn:schemas-upnp-org:service:${this.name}:1#${action}"`,
          "Content-Type": 'text/xml; charset="utf-8"',
        },
        body: envelope,
        signal: controller.signal,
      });
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new SonosError(`Timeout while reaching ${this.host}:${this.port} after ${timeoutMs / 1000} seconds`, "timeout", {
          host: this.host,
          port: this.port,
          timeoutMs,
        });
      }
      throw new SonosError(`Could not reach ${this.host}:${this.port}: ${err?.message || err}`, "network", {
        host: this.host,
        port: this.port,
        cause: err?.message,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();

    if (!response.ok) {
      const fault = parseFault(text);
      if (fault) {
        throw new SonosError(`Sonos returned error ${fault.code}: ${fault.description}`, "fault", {
          host: this.host,
          port: this.port,
          status: response.status,
          faultCode: fault.code,
          faultDescription: fault.description,
        });
      }
      throw new SonosError(`Sonos at ${this.host}:${this.port} returned HTTP ${response.status}`, "http", {
        host: this.host,
        port: this.port,
        status: response.status,
      });
    }

    try {
      return parseResponseBody(text);
    } catch (err) {
      throw new SonosError(`Sonos at ${this.host}:${this.port} returned malformed response: ${err.message}`, "parse", {
        host: this.host,
        port: this.port,
        cause: err.message,
      });
    }
  }
}
