// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach } from "vitest";
import { SonosController } from "@/modules/common/sonosController.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixture = (name) => readFileSync(join(process.cwd(), "tests/fixtures/sonos", name), "utf8");

describe("SonosController – favorites", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = undefined;
  });

  const mockFetch = (topologyBody, cdBody, capture) => {
    globalThis.fetch = vi.fn(async (url, opts) => {
      if (url.includes("ZoneGroupTopology/Control")) {
        return {
          ok: true,
          status: 200,
          text: async () => topologyBody,
        };
      }
      if (url.includes("MediaServer/ContentDirectory/Control")) {
        return {
          ok: true,
          status: 200,
          text: async () => cdBody,
        };
      }
      if (url.includes("MediaRenderer/AVTransport/Control")) {
        if (capture) capture.body = opts?.body ?? "";
        return {
          ok: true,
          status: 200,
          text: async () => fixture("soap-empty-response.xml"),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => "",
      };
    });
  };

  test("empty favorites returns empty array", async () => {
    mockFetch(fixture("zonegroupstate-single-group-single-member.xml"), fixture("browse-fv2-empty.xml"));

    const controller = new SonosController().connect("192.168.1.42", {
      uuid: "RINCON_OFFICE01400",
    });
    const favs = await controller.getFavorites();
    expect(favs).toEqual([]);
  });

  test("single‑child normalization works", async () => {
    mockFetch(fixture("zonegroupstate-single-group-single-member.xml"), fixture("browse-fv2-single.xml"));

    const controller = new SonosController().connect("192.168.1.42", {
      uuid: "RINCON_OFFICE01400",
    });
    const favs = await controller.getFavorites();

    expect(favs).toHaveLength(1);
    expect(favs[0].title).toBe("My Playlist");
    expect(favs[0].metadata.startsWith("<DIDL-Lite")).toBe(true);
    expect(favs[0].metadata).not.toContain("&lt;");
  });

  test("mixed favorites contain 12 items with expected titles and clean metadata", async () => {
    mockFetch(fixture("zonegroupstate-single-group-single-member.xml"), fixture("browse-fv2-mixed.xml"));

    const controller = new SonosController().connect("192.168.1.42", {
      uuid: "RINCON_OFFICE01400",
    });
    const favs = await controller.getFavorites();

    expect(favs).toHaveLength(12);
    const titles = favs.map((f) => f.title);
    expect(titles).toContain("BBC Radio 1");
    expect(titles).toContain("Lana Del Rey — Did You Know That There's a Tunnel Under Ocean Blvd");
    expect(titles).toContain("Café Tacuba — Re");
    expect(titles).toContain("SoundCloud Track");

    // verify metadata cleanliness
    for (const fav of favs) {
      if (fav.metadata) {
        expect(fav.metadata.startsWith("<DIDL-Lite")).toBe(true);
        expect(fav.metadata).not.toContain("&lt;");
      }
    }
  });

  test("metadata round‑trip escapes exactly once", async () => {
    const capture = { body: "" };
    mockFetch(fixture("zonegroupstate-single-group-single-member.xml"), fixture("browse-fv2-mixed.xml"), capture);

    const controller = new SonosController().connect("192.168.1.42", {
      uuid: "RINCON_OFFICE01400",
    });
    const favs = await controller.getFavorites();

    const favWithMeta = favs.find((f) => f.metadata && f.metadata.length > 0);
    expect(favWithMeta).toBeDefined();

    // ensure raw metadata is clean
    expect(favWithMeta.metadata).not.toContain("&lt;");

    // invoke addURIToQueue which should cause a single escape
    await controller.addURIToQueue(favWithMeta.uri, favWithMeta.metadata);

    const body = capture.body;
    expect(body).toContain("&lt;DIDL-Lite");
    expect(body).not.toContain("&amp;lt;");
  });
});
