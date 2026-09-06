// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach, beforeEach } from "vitest";
import { SonosController } from "@/modules/common/sonosController.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixture = (name) => readFileSync(join(process.cwd(), "tests/fixtures/sonos", name), "utf8");

describe("SonosController routing", () => {
  let originalFetch;
  let fetchCalls = [];
  let topologyBody = fixture("zonegroupstate-multi-group.xml");

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchCalls = [];

    globalThis.fetch = vi.fn(async (url, opts) => {
      const urlObj = new URL(url);
      const path = urlObj.pathname;

      let body = "";
      if (path.endsWith("ZoneGroupTopology/Control")) {
        body = topologyBody;
      } else if (path.endsWith("MediaRenderer/AVTransport/Control")) {
        body = fixture("soap-empty-response.xml");
      } else if (path.endsWith("MediaRenderer/RenderingControl/Control")) {
        body = fixture("soap-empty-response.xml");
      } else if (path.endsWith("MediaServer/ContentDirectory/Control")) {
        if (opts?.body?.includes("Q:0")) {
          body = fixture("browse-q0-five-tracks.xml");
        } else if (opts?.body?.includes("FV:2")) {
          body = fixture("browse-fv2-mixed.xml");
        } else {
          body = fixture("soap-empty-response.xml");
        }
      }

      fetchCalls.push({
        url,
        method: opts?.method,
        headers: opts?.headers,
        body: opts?.body,
        host: urlObj.hostname,
        path,
      });

      return {
        ok: true,
        status: 200,
        text: async () => body,
      };
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("play() routes to coordinator (Kitchen) when bound to non-coordinator (Dining Room)", async () => {
    const controller = new SonosController();
    await controller.connect("192.168.1.44", { uuid: "RINCON_DININGROOM01400" });

    await controller.play();

    // Verify topology fetch went to bound host
    const topologyCall = fetchCalls.find((c) => c.path.endsWith("ZoneGroupTopology/Control"));
    expect(topologyCall?.host).toBe("192.168.1.44");

    // Verify play() POST went to coordinator (Kitchen)
    const playCall = fetchCalls.find((c) => c.path.endsWith("MediaRenderer/AVTransport/Control"));
    expect(playCall?.host).toBe("192.168.1.43");
    expect(playCall?.body).toContain("<u:Play ");
  });

  test("setVolume(30) routes to bound speaker (Dining Room), not coordinator", async () => {
    const controller = new SonosController();
    await controller.connect("192.168.1.44", { uuid: "RINCON_DININGROOM01400" });

    await controller.setVolume(30);

    const volumeCall = fetchCalls.find((c) => c.path.endsWith("MediaRenderer/RenderingControl/Control"));
    expect(volumeCall?.host).toBe("192.168.1.44");
    expect(volumeCall?.body).toContain("<DesiredVolume>30</DesiredVolume>");
  });

  test("getQueue() routes to coordinator and returns correct list", async () => {
    const controller = new SonosController();
    await controller.connect("192.168.1.44", { uuid: "RINCON_DININGROOM01400" });

    const result = await controller.getQueue();

    const browseCall = fetchCalls.find((c) => c.path.endsWith("MediaServer/ContentDirectory/Control"));
    expect(browseCall?.host).toBe("192.168.1.43");
    expect(browseCall?.body).toContain("<ObjectID>Q:0</ObjectID>");

    expect(result).toEqual({
      start: 0,
      count: 5,
      list: [
        {
          title: "Track One",
          artist: "Artist A",
          album: "Album One",
          uri: "x-sonos-spotify:track1",
          albumArtURI: "/getaa?u=track1",
        },
        {
          title: "Track Two",
          artist: "Artist B",
          album: "Album Two",
          uri: "x-sonos-spotify:track2",
          albumArtURI: "/getaa?u=track2",
        },
        {
          title: "Track Three",
          artist: "Artist C",
          album: "Album Three",
          uri: "x-sonos-spotify:track3",
          albumArtURI: "/getaa?u=track3",
        },
        {
          title: "Track Four",
          artist: "Artist D",
          album: "Album Four",
          uri: "x-sonos-spotify:track4",
          albumArtURI: "/getaa?u=track4",
        },
        {
          title: "Track Five",
          artist: "Artist E",
          album: "Album Five",
          uri: "x-sonos-spotify:track5",
          albumArtURI: "/getaa?u=track5",
        },
      ],
    });
  });

  test("getFavorites() routes to bound speaker (Dining Room) and sends correct ObjectID", async () => {
    const controller = new SonosController();
    await controller.connect("192.168.1.44", { uuid: "RINCON_DININGROOM01400" });

    await controller.getFavorites();

    const browseCall = fetchCalls.find((c) => c.path.endsWith("MediaServer/ContentDirectory/Control"));
    expect(browseCall?.host).toBe("192.168.1.44");
    expect(browseCall?.body).toContain("<ObjectID>FV:2</ObjectID>");
  });

  test("fresh coordinator service per call / topology change", async () => {
    const controller = new SonosController();
    await controller.connect("192.168.1.44", { uuid: "RINCON_DININGROOM01400" });

    // First play() → coordinator is Kitchen (.43)
    await controller.play();
    const firstPlayCall = fetchCalls.find((c) => c.path.endsWith("MediaRenderer/AVTransport/Control"));
    expect(firstPlayCall?.host).toBe("192.168.1.43");

    // Mutate topology body to change coordinator to Dining Room (.44)
    topologyBody = topologyBody.replaceAll('Coordinator="RINCON_KITCHEN01400"', 'Coordinator="RINCON_DININGROOM01400"');

    // Force refresh zone group state
    await controller.getZoneGroupState({ forceRefresh: true });

    // Second play() → coordinator is now Dining Room (.44)
    await controller.play();
    const secondPlayCall = fetchCalls.filter((c) => c.path.endsWith("MediaRenderer/AVTransport/Control"))[1];
    expect(secondPlayCall?.host).toBe("192.168.1.44");

    // Assert two distinct hosts across two plays
    expect(firstPlayCall?.host).not.toBe(secondPlayCall?.host);
  });
});
