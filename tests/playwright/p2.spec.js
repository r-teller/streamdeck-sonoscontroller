// @vitest-environment jsdom
import { test, expect } from "@playwright/test";
import { installMockSonos } from "./support/mockSonos.js";

test.describe("Phase-2 scenarios", () => {
  test("p2-discovery-multigroup", async ({ page }) => {
    const mock = await installMockSonos(page, {
      topologyFixture: "zonegroupstate-multi-group.xml",
      favoritesFixture: "browse-fv2-mixed.xml",
      queueFixture: "browse-q0-five-tracks.xml"
    });

    await page.goto("/harness/sonos-probe.html");

    const res = await page.evaluate(async () => {
      return window.probe(async (SonosController) => {
        const c = new SonosController({ timeoutSec: 5 }).connect("192.168.1.42", { uuid: "RINCON_OFFICE01400" });
        return c.getDevices();
      });
    });

    expect(res.ok).toBe(true);
    expect(Array.isArray(res.result)).toBe(true);
    expect(res.result.length).toBe(4);

    await page.screenshot({ path: "tests/playwright/screenshots/p2-discovery.png", fullPage: true });
  });

  test("p2-discovery-solo", async ({ page }) => {
    const mock = await installMockSonos(page, {
      topologyFixture: "zonegroupstate-single-group-single-member.xml",
      favoritesFixture: "browse-fv2-mixed.xml",
      queueFixture: "browse-q0-five-tracks.xml"
    });

    const messages = [];
    page.on("console", (m) => messages.push(m.text()));
    page.on("pageerror", (e) => messages.push(e.message));

    await page.goto("/harness/sonos-probe.html");

    const res = await page.evaluate(async () => {
      return window.probe(async (SonosController) => {
        const c = new SonosController({ timeoutSec: 5 }).connect("192.168.1.42", { uuid: "RINCON_OFFICE01400" });
        return c.getDevices();
      });
    });

    expect(res.ok).toBe(true);
    expect(Array.isArray(res.result)).toBe(true);
    expect(res.result.length).toBe(1);
    expect(messages.every(t => !t.includes("is not iterable"))).toBe(true);
  });

  test("p2-favorites-mixed", async ({ page }) => {
    const mock = await installMockSonos(page, {
      topologyFixture: "zonegroupstate-multi-group.xml",
      favoritesFixture: "browse-fv2-mixed.xml",
      queueFixture: "browse-q0-five-tracks.xml"
    });

    await page.goto("/harness/sonos-probe.html");

    const res = await page.evaluate(async () => {
      return window.probe(async (SonosController) => {
        const c = new SonosController({ timeoutSec: 5 }).connect("192.168.1.42", { uuid: "RINCON_OFFICE01400" });
        return c.getFavorites();
      });
    });

    expect(res.ok).toBe(true);
    expect(Array.isArray(res.result)).toBe(true);
    expect(res.result.length).toBe(12);

    const titles = res.result.map(f => f.title);
    expect(titles).toContain("BBC Radio 1");
    expect(titles).toContain("Lana Del Rey — Did You Know That There's a Tunnel Under Ocean Blvd");
    expect(titles).toContain("Café Tacuba — Re");
  });

  test("p2-timeout", async ({ page }) => {
    test.setTimeout(30_000);

    const mock = await installMockSonos(page, {
      topologyFixture: "zonegroupstate-multi-group.xml",
      favoritesFixture: "browse-fv2-mixed.xml",
      queueFixture: "browse-q0-five-tracks.xml",
      failures: { topology: { mode: "hang", ms: 6000 } }
    });

    await page.goto("/harness/sonos-probe.html");

    const res = await page.evaluate(async () => {
      return window.probe(async (SonosController) => {
        const c = new SonosController({ timeoutSec: 5 }).connect("192.168.1.42", { uuid: "RINCON_OFFICE01400" });
        return c.getDevices();
      });
    });

    expect(res.ok).toBe(false);
    expect(res.error).toBe("Failed to get devices: Timeout while reaching 192.168.1.42:1400 after 5 seconds");

    const outputText = await page.textContent("#output");
    expect(outputText).toBe("Failed to get devices: Timeout while reaching 192.168.1.42:1400 after 5 seconds");
  });

  test("p2-fault", async ({ page }) => {
    const mock = await installMockSonos(page, {
      topologyFixture: "zonegroupstate-multi-group.xml",
      favoritesFixture: "browse-fv2-mixed.xml",
      queueFixture: "browse-q0-five-tracks.xml",
      failures: { topology: { mode: "fault500" } }
    });

    await page.goto("/harness/sonos-probe.html");

    const res = await page.evaluate(async () => {
      return window.probe(async (SonosController) => {
        const c = new SonosController({ timeoutSec: 5 }).connect("192.168.1.42", { uuid: "RINCON_OFFICE01400" });
        return c.getDevices();
      });
    });

    expect(res.ok).toBe(false);
    expect(res.error).toBe("Failed to get devices: Sonos returned error 401: Invalid Action");
  });

  test("p2-coordinator-routing", async ({ page }) => {
    const mock = await installMockSonos(page, {
      topologyFixture: "zonegroupstate-multi-group.xml",
      favoritesFixture: "browse-fv2-mixed.xml",
      queueFixture: "browse-q0-five-tracks.xml"
    });

    await page.goto("/harness/sonos-probe.html");

    const res = await page.evaluate(async () => {
      return window.probe(async (SonosController) => {
        const c = new SonosController({ timeoutSec: 5 }).connect("192.168.1.44", { uuid: "RINCON_DININGROOM01400" });
        await c.play();
        await c.setVolume(30);
        return "done";
      });
    });

    expect(res.ok).toBe(true);
    expect(res.result).toBe("done");

    const calls = mock.calls;
    const playCall = calls.find(c => c.action === "Play");
    const setVolCall = calls.find(c => c.action === "SetVolume");

    expect(playCall).toBeDefined();
    expect(setVolCall).toBeDefined();
    expect(playCall.host).toBe("192.168.1.43");
    expect(setVolCall.host).toBe("192.168.1.44");
  });
});
