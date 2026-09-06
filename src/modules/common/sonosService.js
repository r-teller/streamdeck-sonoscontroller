import { SonosError } from "./sonosErrors.js";

export const SONOS_SERVICES = Object.freeze({
  avTransport: Object.freeze({ name: "AVTransport", baseUrl: "MediaRenderer/AVTransport/Control" }),
  renderingControl: Object.freeze({ name: "RenderingControl", baseUrl: "MediaRenderer/RenderingControl/Control" }),
  zoneGroupTopology: Object.freeze({ name: "ZoneGroupTopology", baseUrl: "ZoneGroupTopology/Control" }),
  contentDirectory: Object.freeze({ name: "ContentDirectory", baseUrl: "MediaServer/ContentDirectory/Control" }),
  deviceProperties: Object.freeze({ name: "DeviceProperties", baseUrl: "DeviceProperties/Control" }),
  audioIn: Object.freeze({ name: "AudioIn", baseUrl: "AudioIn/Control" }),
});

function xmlEscape(value) {
  const map = {
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
  };
  return String(value).replace(/[<>&"']/g, (ch) => map[ch]);
}

export class SonosService {
  constructor({ host, name, baseUrl, port = 1400, defaultTimeoutMs = 10_000 }) {
    this.host = host;
    this.name = name;
    this.baseUrl = baseUrl;
    this.port = port;
    this.defaultTimeoutMs = defaultTimeoutMs;
    this.url = `http://${host}:${port}/${baseUrl}`;
  }

  #buildEnvelope(action, args) {
    const argsXml = Object.entries(args)
      .map(([key, value]) => `<${key}>${xmlEscape(value)}</${key}>`)
      .join("");
    return `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="urn:schemas-upnp-org:service:${this.name}:1">${argsXml}</u:${action}></s:Body></s:Envelope>`;
  }

  #parseResponseBody(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "text/xml");

    const parserError = doc.querySelector("parsererror");
    if (parserError) {
      throw new SonosError(
        `Sonos at ${this.host}:${this.port} returned malformed response: ${parserError.textContent}`,
        "parse",
        { host: this.host, port: this.port },
      );
    }

    // Try namespace-aware first
    let body = doc.getElementsByTagNameNS("http://schemas.xmlsoap.org/soap/envelope/", "Body")[0];
    if (!body) {
      body = doc.getElementsByTagName("s:Body")[0];
    }
    if (!body) {
      body = doc.getElementsByTagName("Body")[0];
    }

    if (!body) {
      throw new SonosError(`Sonos at ${this.host}:${this.port} returned malformed response: missing Body element`, "parse", {
        host: this.host,
        port: this.port,
      });
    }

    const wrapper = body.firstElementChild;
    if (!wrapper) {
      return {};
    }

    const result = {};
    for (const child of wrapper.children) {
      result[child.nodeName] = child.textContent ?? "";
    }
    return result;
  }

  async execute(action, args = {}, { timeoutMs } = {}) {
    const effectiveTimeoutMs = timeoutMs ?? this.defaultTimeoutMs;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), effectiveTimeoutMs);

    try {
      const body = this.#buildEnvelope(action, args);
      const soapAction = `"urn:schemas-upnp-org:service:${this.name}:1#${action}"`;

      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          SOAPAction: soapAction,
          "Content-Type": 'text/xml; charset="utf-8"',
        },
        body,
        signal: abortController.signal,
      }).catch((err) => {
        if (err.name === "AbortError") {
          throw new SonosError(
            `Timeout while reaching ${this.host}:${this.port} after ${effectiveTimeoutMs / 1000} seconds`,
            "timeout",
            { host: this.host, port: this.port, timeoutMs: effectiveTimeoutMs },
          );
        }
        throw new SonosError(`Could not reach ${this.host}:${this.port}: ${err.message}`, "network", {
          host: this.host,
          port: this.port,
          cause: err.message,
        });
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, "text/xml");
        const parserError = doc.querySelector("parsererror");

        if (parserError) {
          throw new SonosError(`Sonos at ${this.host}:${this.port} returned HTTP ${response.status}`, "http", {
            host: this.host,
            port: this.port,
            status: response.status,
          });
        }

        const errorCodeEl = doc.querySelector("errorCode");
        const errorDescriptionEl = doc.querySelector("errorDescription");

        if (errorCodeEl && errorCodeEl.textContent) {
          const faultCode = errorCodeEl.textContent.trim();
          const faultDescription = errorDescriptionEl?.textContent?.trim() || "Unknown error";
          throw new SonosError(`Sonos returned error ${faultCode}: ${faultDescription}`, "fault", {
            host: this.host,
            port: this.port,
            faultCode,
            faultDescription,
            status: response.status,
          });
        }

        throw new SonosError(`Sonos at ${this.host}:${this.port} returned HTTP ${response.status}`, "http", {
          host: this.host,
          port: this.port,
          status: response.status,
        });
      }

      const bodyText = await response.text();
      return this.#parseResponseBody(bodyText);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
