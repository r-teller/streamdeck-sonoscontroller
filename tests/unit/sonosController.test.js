// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { SonosController } from "@/modules/common/sonosController.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/sonos");
const fixture = (name) => readFileSync(resolve(FIXTURES, name), "utf8");

const okResponse = (body) =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: () => Promise.resolve(body),
  });

describe("SonosController — service endpoint registration (AC#1)", () => {
  let fetchMock;
  let controller;

  beforeEach(() => {
    fetchMock = vi.fn(() =>
      okResponse('<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body/></s:Envelope>'),
    );
    vi.stubGlobal("fetch", fetchMock);
    controller = new SonosController().connect("192.168.1.42");
  });

  it.each([
    ["audioIn", "AudioIn/Control"],
    ["avTransport", "MediaRenderer/AVTransport/Control"],
    ["deviceProperties", "DeviceProperties/Control"],
    ["renderingControl", "MediaRenderer/RenderingControl/Control"],
    ["zoneGroupTopology", "ZoneGroupTopology/Control"],
    ["contentDirectory", "MediaServer/ContentDirectory/Control"],
  ])("%s service POSTs to http://<host>:1400/%s", async (key, baseUrl) => {
    await controller[key].execute("Action");
    const url = fetchMock.mock.calls[0][0];
    expect(url).toBe(`http://192.168.1.42:1400/${baseUrl}`);
  });

  it("each service uses the right SOAPAction service-name (AVTransport ≠ ContentDirectory)", async () => {
    await controller.avTransport.execute("Play");
    expect(fetchMock.mock.calls[0][1].headers.SOAPAction).toBe('"urn:schemas-upnp-org:service:AVTransport:1#Play"');
    fetchMock.mockClear();
    await controller.contentDirectory.execute("Browse");
    expect(fetchMock.mock.calls[0][1].headers.SOAPAction).toBe('"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"');
  });

  it("connect() returns the controller for chaining", () => {
    const c = new SonosController().connect("192.168.1.99");
    expect(c).toBeInstanceOf(SonosController);
    expect(c.host).toBe("192.168.1.99");
  });

  it("re-connecting to a different host points the services at the new host", async () => {
    controller.connect("10.0.0.5");
    await controller.avTransport.execute("Play");
    const url = fetchMock.mock.calls[0][0];
    expect(url).toBe("http://10.0.0.5:1400/MediaRenderer/AVTransport/Control");
  });
});

describe("SonosController — getZoneGroupState memoization (AC#2)", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn(() => okResponse(fixture("zonegroupstate-single-group-single-member.xml")));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("first call hits the network; second call returns cached value", async () => {
    const c = new SonosController().connect("192.168.1.42");
    const first = await c.getZoneGroupState();
    const second = await c.getZoneGroupState();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("memoized topology contains the parsed ZoneGroup tree", async () => {
    const c = new SonosController().connect("192.168.1.42");
    const state = await c.getZoneGroupState();
    expect(state.ZoneGroups.ZoneGroup._attributes.Coordinator).toBe("RINCON_OFFICE01400");
    expect(state.ZoneGroups.ZoneGroup.ZoneGroupMember._attributes.ZoneName).toBe("Office");
  });

  it("forceRefresh: true bypasses the memo and re-fetches", async () => {
    const c = new SonosController().connect("192.168.1.42");
    await c.getZoneGroupState();
    await c.getZoneGroupState({ forceRefresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-connecting to a different host clears the memo", async () => {
    const c = new SonosController().connect("192.168.1.42");
    await c.getZoneGroupState();
    c.connect("10.0.0.5");
    await c.getZoneGroupState();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws if called before connect()", async () => {
    const c = new SonosController();
    await expect(c.getZoneGroupState()).rejects.toThrow(/before connect/);
  });
});

describe("SonosController — instance isolation (AC#3)", () => {
  it("two controllers have independent memos", async () => {
    const fetchMock = vi.fn(() => okResponse(fixture("zonegroupstate-single-group-single-member.xml")));
    vi.stubGlobal("fetch", fetchMock);

    const a = new SonosController().connect("192.168.1.42");
    const b = new SonosController().connect("192.168.1.99");
    await a.getZoneGroupState();
    await b.getZoneGroupState();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("192.168.1.42");
    expect(fetchMock.mock.calls[1][0]).toContain("192.168.1.99");
  });
});

describe("SonosController — timeout threading", () => {
  it("threads timeoutSec into service constructor as defaultTimeoutMs", () => {
    const c = new SonosController({ timeoutSec: 5 }).connect("192.168.1.42");
    expect(c.avTransport.defaultTimeoutMs).toBe(5_000);
    expect(c.renderingControl.defaultTimeoutMs).toBe(5_000);
  });

  it("uses 10 seconds as the documented default", () => {
    const c = new SonosController().connect("192.168.1.42");
    expect(c.avTransport.defaultTimeoutMs).toBe(10_000);
  });
});
