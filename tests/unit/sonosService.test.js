// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { SonosService, parseResponseBody, parseFault } from "@/modules/common/sonosService.js";
import { SonosError } from "@/modules/common/sonosErrors.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/sonos");
const fixture = (name) => readFileSync(resolve(FIXTURES, name), "utf8");

const newService = (overrides = {}) =>
  new SonosService({
    host: "192.168.1.42",
    name: "AVTransport",
    baseUrl: "MediaRenderer/AVTransport/Control",
    ...overrides,
  });

const okResponse = (body) =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
  });

const failResponse = (status, body) =>
  Promise.resolve({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  });

describe("SonosService — URL construction", () => {
  it("builds the canonical Control URL from host + baseUrl", () => {
    const s = newService();
    expect(s.url).toBe("http://192.168.1.42:1400/MediaRenderer/AVTransport/Control");
  });

  it("respects a non-default port", () => {
    const s = newService({ port: 1401 });
    expect(s.url).toBe("http://192.168.1.42:1401/MediaRenderer/AVTransport/Control");
  });
});

describe("SonosService — outgoing request shape (AC#1, AC#4)", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn(() => okResponse('<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body/></s:Envelope>'));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("POSTs to the right URL with the Sonos SOAPAction header", async () => {
    const s = newService();
    await s.execute("Play", { InstanceID: 0, Speed: 1 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://192.168.1.42:1400/MediaRenderer/AVTransport/Control");
    expect(init.method).toBe("POST");
    expect(init.headers.SOAPAction).toBe('"urn:schemas-upnp-org:service:AVTransport:1#Play"');
    expect(init.headers["Content-Type"]).toBe('text/xml; charset="utf-8"');
  });

  it("envelope contains the action wrapper namespaced to the service", async () => {
    const s = newService();
    await s.execute("Play", { InstanceID: 0, Speed: 1 });
    const body = fetchMock.mock.calls[0][1].body;
    expect(body).toContain('<u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">');
    expect(body).toContain("</u:Play>");
    expect(body).toContain("<InstanceID>0</InstanceID>");
    expect(body).toContain("<Speed>1</Speed>");
  });

  it("XML-escapes args containing <, >, &, \", ' (AC#4)", async () => {
    const s = newService();
    await s.execute("SetAVTransportURI", { CurrentURI: 'foo<bar>&"baz\'qux' });
    const body = fetchMock.mock.calls[0][1].body;
    expect(body).toContain("<CurrentURI>foo&lt;bar&gt;&amp;&quot;baz&apos;qux</CurrentURI>");
    expect(body).not.toContain('foo<bar>&"baz\'qux');
  });

  it("empty args produces a self-empty action element", async () => {
    const s = newService({ name: "ZoneGroupTopology", baseUrl: "ZoneGroupTopology/Control" });
    await s.execute("GetZoneGroupState");
    const body = fetchMock.mock.calls[0][1].body;
    expect(body).toContain('<u:GetZoneGroupState xmlns:u="urn:schemas-upnp-org:service:ZoneGroupTopology:1"></u:GetZoneGroupState>');
  });
});

describe("SonosService — response parsing (AC#2)", () => {
  it("flattens GetVolumeResponse into {CurrentVolume: '42'}", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okResponse(fixture("soap-getvolume-response.xml"))));
    const s = newService({ name: "RenderingControl", baseUrl: "MediaRenderer/RenderingControl/Control" });
    const result = await s.execute("GetVolume", { InstanceID: 0, Channel: "Master" });
    expect(result).toEqual({ CurrentVolume: "42" });
  });

  it("returns {} when the response body is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        okResponse(
          '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body/></s:Envelope>',
        ),
      ),
    );
    const s = newService();
    expect(await s.execute("Play")).toEqual({});
  });

  it("preserves all values as strings (no numeric coercion)", () => {
    const xml =
      '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">' +
      "<s:Body><u:Resp xmlns:u=\"urn:x\"><Volume>50</Volume><Mute>0</Mute><Track>1</Track></u:Resp></s:Body></s:Envelope>";
    expect(parseResponseBody(xml)).toEqual({ Volume: "50", Mute: "0", Track: "1" });
  });

  it("throws on malformed XML", () => {
    expect(() => parseResponseBody("<not a valid envelope")).toThrow(/Malformed XML/);
  });
});

describe("SonosService — timeout + abort (AC#3)", () => {
  it("rejects with a human-readable timeout message naming host:port", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => {
              const err = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          }),
      ),
    );
    const s = newService();
    // Tame the rejection before advancing time so vitest's unhandled-rejection
    // detector doesn't flag the in-flight error.
    const tamed = s.execute("Play", {}, { timeoutMs: 50 }).catch((err) => err);
    await vi.advanceTimersByTimeAsync(100);
    const result = await tamed;
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toMatch(/Timeout while reaching 192\.168\.1\.42:1400 after 0\.05 seconds/);
    vi.useRealTimers();
  });

  it("does not abort when fetch resolves before the timeout", async () => {
    let signalSeen;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) => {
        signalSeen = init.signal;
        return okResponse('<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body/></s:Envelope>');
      }),
    );
    const s = newService();
    await s.execute("Play", {}, { timeoutMs: 60_000 });
    // Wait one event-loop tick beyond what could conceivably fire a timer.
    await new Promise((r) => setTimeout(r, 0));
    expect(signalSeen.aborted).toBe(false);
  });
});

describe("SonosService — categorized SonosError (AC#5, prd-what.md §7.7)", () => {
  it("throws SonosError with category=fault on a 5xx with a UPnP fault body", async () => {
    vi.stubGlobal("fetch", vi.fn(() => failResponse(500, fixture("soap-fault-401.xml"))));
    const s = newService();
    const err = await s.execute("Play").catch((e) => e);
    expect(err).toBeInstanceOf(SonosError);
    expect(err.category).toBe("fault");
    expect(err.context.faultCode).toBe("401");
    expect(err.context.faultDescription).toBe("Invalid Action");
    expect(err.message).toMatch(/Sonos returned error 401: Invalid Action/);
  });

  it("throws SonosError with category=http on a non-fault 5xx", async () => {
    vi.stubGlobal("fetch", vi.fn(() => failResponse(503, "Service Unavailable")));
    const s = newService();
    const err = await s.execute("Play").catch((e) => e);
    expect(err).toBeInstanceOf(SonosError);
    expect(err.category).toBe("http");
    expect(err.context.status).toBe(503);
  });

  it("throws SonosError with category=network on fetch rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );
    const s = newService();
    const err = await s.execute("Play").catch((e) => e);
    expect(err).toBeInstanceOf(SonosError);
    expect(err.category).toBe("network");
    expect(err.context.host).toBe("192.168.1.42");
    expect(err.context.cause).toBe("fetch failed");
  });

  it("throws SonosError with category=parse on malformed response", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okResponse("<not closed")));
    const s = newService();
    const err = await s.execute("Play").catch((e) => e);
    expect(err).toBeInstanceOf(SonosError);
    expect(err.category).toBe("parse");
  });

  it("never lets a TypeError escape — always wrapped in SonosError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
    );
    const s = newService();
    const err = await s.execute("Play").catch((e) => e);
    expect(err).not.toBeInstanceOf(TypeError);
    expect(err).toBeInstanceOf(SonosError);
  });
});

describe("parseFault — direct tests", () => {
  it("returns null for a non-fault body", () => {
    expect(parseFault(fixture("soap-getvolume-response.xml"))).toBe(null);
  });

  it("extracts {code, description} from a UPnPError fault", () => {
    expect(parseFault(fixture("soap-fault-401.xml"))).toEqual({
      code: "401",
      description: "Invalid Action",
    });
  });

  it("falls back to 'Unknown error' when description is missing", () => {
    const xml =
      '<?xml version="1.0"?><Envelope><Body><Fault><detail><UPnPError>' +
      "<errorCode>500</errorCode>" +
      "</UPnPError></detail></Fault></Body></Envelope>";
    expect(parseFault(xml)).toEqual({ code: "500", description: "Unknown error" });
  });

  it("returns null for malformed XML rather than throwing", () => {
    expect(parseFault("<not closed")).toBe(null);
  });
});
