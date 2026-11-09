// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach } from "vitest";
import { SonosController } from "@/modules/common/sonosController.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixture = (name) => readFileSync(join(process.cwd(), "tests/fixtures/sonos", name), "utf8");

describe("SonosController – discovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // restore original fetch if it was overwritten
    globalThis.fetch = undefined;
  });

  const topologyCases = [
    ["zonegroupstate-single-group-single-member.xml", 1, 0],
    ["zonegroupstate-stereo-pair.xml", 2, 1],
    ["zonegroupstate-home-theater.xml", 4, 3],
    ["zonegroupstate-multi-group.xml", 4, 0],
    ["zonegroupstate-live-bonded-and-grouped.xml", 6, 3],
  ];

  test.each(topologyCases)("parses %s → %i records, %i satellites", async (file, expectedCount, expectedSatellites) => {
    // stub fetch for topology requests
    globalThis.fetch = vi.fn(async (url) => {
      if (url.includes("ZoneGroupTopology/Control")) {
        return {
          ok: true,
          status: 200,
          text: async () => fixture(file),
        };
      }
      // default empty response for any other service
      return {
        ok: true,
        status: 200,
        text: async () => "",
      };
    });

    const controller = new SonosController().connect("192.168.0.1", {});
    const devices = await controller.getDevices();

    expect(devices).toHaveLength(expectedCount);
    const satCount = devices.filter((d) => d.isSatellite).length;
    expect(satCount).toBe(expectedSatellites);
  });

  test("setAsPrimary marks exactly the seed host", async () => {
    const topologyFile = "zonegroupstate-multi-group.xml";

    globalThis.fetch = vi.fn(async (url) => {
      if (url.includes("ZoneGroupTopology/Control")) {
        return {
          ok: true,
          status: 200,
          text: async () => fixture(topologyFile),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => "",
      };
    });

    const seedHost = "192.168.1.44"; // Dining Room in the multi‑group fixture
    const controller = new SonosController().connect(seedHost, {});
    const devices = await controller.getDevices({ setAsPrimary: true });

    const primaryDevices = devices.filter((d) => d.primary);
    expect(primaryDevices).toHaveLength(1);
    expect(primaryDevices[0].hostAddress).toBe(seedHost);
  });
});
