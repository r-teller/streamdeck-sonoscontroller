// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach } from "vitest";
import { SonosService } from "@/modules/common/sonosService.js";
import { SonosError } from "@/modules/common/sonosErrors.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixture = (name) => readFileSync(join(process.cwd(), "tests/fixtures/sonos", name), "utf8");

describe("SonosService", () => {
  const originalFetch = globalThis.fetch;
  const originalClearTimeout = globalThis.clearTimeout;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("envelope is byte‑exact and headers are correctly quoted", async () => {
    const svc = new SonosService({
      host: "192.168.1.42",
      name: "RenderingControl",
      baseUrl: "MediaRenderer/RenderingControl/Control",
    });

    let capturedOpts;
    globalThis.fetch = vi.fn().mockImplementation((_url, opts) => {
      capturedOpts = opts;
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => fixture("soap-getvolume-response.xml"),
      });
    });

    await svc.execute("GetVolume", { InstanceID: 0, Channel: "Master" });

    const expectedEnvelope =
      '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:GetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID><Channel>Master</Channel></u:GetVolume></s:Body></s:Envelope>';

    expect(capturedOpts.body).toBe(expectedEnvelope);
    expect(capturedOpts.headers.SOAPAction).toBe(
      '"urn:schemas-upnp-org:service:RenderingControl:1#GetVolume"',
    );
    expect(capturedOpts.headers["Content-Type"]).toBe(
      'text/xml; charset="utf-8"',
    );
  });

  test("empty args produce non‑self‑closed action element", async () => {
    const svc = new SonosService({
      host: "1.2.3.4",
      name: "AVTransport",
      baseUrl: "MediaRenderer/AVTransport/Control",
    });

    let body;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => fixture("soap-empty-response.xml"),
    });
    // capture body via spy on fetch implementation
    globalThis.fetch = vi.fn().mockImplementation((_url, opts) => {
      body = opts.body;
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => fixture("soap-empty-response.xml"),
      });
    });

    await svc.execute("Play", {}); // no args

    // ensure there is a closing tag, not a self‑closing one
    expect(body).toContain(
      `<u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"></u:Play>`,
    );
    expect(body).not.toContain("<u:Play xmlns:u=\"urn:schemas-upnp-org:service:AVTransport:1\"/>");
  });

  test("xmlEscape performs a single pass on all five characters", async () => {
    const svc = new SonosService({
      host: "h",
      name: "RenderingControl",
      baseUrl: "MediaRenderer/RenderingControl/Control",
    });

    const special = `<>&"'`;
    const escaped = "&lt;&gt;&amp;&quot;&apos;";

    let body;
    globalThis.fetch = vi.fn().mockImplementation((_url, opts) => {
      body = opts.body;
      return Promise.resolve({
        ok: true,
        status: 200,
        text: async () => fixture("soap-empty-response.xml"),
      });
    });

    await svc.execute("SetVolume", { Test: special });

    expect(body).toContain(`<Test>${escaped}</Test>`);
    // ensure no double‑escaping
    expect(body).not.toContain(`&amp;lt;`);
  });

  test("successful response parses to string map", async () => {
    const svc = new SonosService({
      host: "h",
      name: "RenderingControl",
      baseUrl: "MediaRenderer/RenderingControl/Control",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => fixture("soap-getvolume-response.xml"),
    });

    const result = await svc.execute("GetVolume", { InstanceID: 0, Channel: "Master" });
    expect(result).toEqual({ CurrentVolume: "42" });
  });

  test("empty response body yields empty object", async () => {
    const svc = new SonosService({
      host: "h",
      name: "AVTransport",
      baseUrl: "MediaRenderer/AVTransport/Control",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => fixture("soap-empty-response.xml"),
    });

    const result = await svc.execute("GetPositionInfo", {});
    expect(result).toEqual({});
  });

  test("fault 401 is translated to category 'fault'", async () => {
    const svc = new SonosService({
      host: "h",
      name: "RenderingControl",
      baseUrl: "MediaRenderer/RenderingControl/Control",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => fixture("soap-fault-401.xml"),
    });

    await expect(svc.execute("GetVolume", {})).rejects.toMatchObject({
      category: "fault",
    });
  });

  test("non‑ok response without errorCode yields category 'http'", async () => {
    const svc = new SonosService({
      host: "h",
      name: "AVTransport",
      baseUrl: "MediaRenderer/AVTransport/Control",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => "<html>Not Found</html>",
    });

    await expect(svc.execute("Play", {})).rejects.toMatchObject({
      category: "http",
    });
  });

  test("malformed successful response triggers parse category", async () => {
    const svc = new SonosService({
      host: "h",
      name: "AVTransport",
      baseUrl: "MediaRenderer/AVTransport/Control",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => "<invalid><unclosed>",
    });

    await expect(svc.execute("Play", {})).rejects.toMatchObject({
      category: "parse",
    });
  });

  test("timeout aborts after specified ms and clears timer", async () => {
    const svc = new SonosService({
      host: "h",
      name: "AVTransport",
      baseUrl: "MediaRenderer/AVTransport/Control",
    });

    // fetch that never resolves but respects abort signal
    globalThis.fetch = (url, opts) =>
      new Promise((_, reject) => {
        opts.signal.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });

    const clearSpy = vi.spyOn(globalThis, "clearTimeout");

    await expect(
      svc.execute("Play", {}, { timeoutMs: 50 }),
    ).rejects.toMatchObject({ category: "timeout" });

    // message should contain 0.05 seconds
    await expect(
      svc.execute("Play", {}, { timeoutMs: 50 }),
    ).rejects.toThrow(/after 0\.05 seconds/);

    expect(clearSpy).toHaveBeenCalledTimes(2); // one for each call
  });

  test("timer is cleared on success path as well", async () => {
    const svc = new SonosService({
      host: "h",
      name: "AVTransport",
      baseUrl: "MediaRenderer/AVTransport/Control",
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => fixture("soap-getvolume-response.xml"),
    });

    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    await svc.execute("GetVolume", { InstanceID: 0, Channel: "Master" });
    expect(clearSpy).toHaveBeenCalledOnce();
  });
});
