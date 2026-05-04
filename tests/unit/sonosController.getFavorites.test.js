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

describe("SonosController.getFavorites — Browse FV:2 SOAP args", () => {
  let fetchMock;
  let controller;

  beforeEach(() => {
    fetchMock = vi.fn(() => okResponse(fixture("browse-fv2-empty.xml")));
    vi.stubGlobal("fetch", fetchMock);
    controller = new SonosController().connect("192.168.1.42");
  });

  it("POSTs to ContentDirectory/Control with the verbatim Browse arg set", async () => {
    await controller.getFavorites();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://192.168.1.42:1400/MediaServer/ContentDirectory/Control");
    expect(init.headers.SOAPAction).toBe(
      '"urn:schemas-upnp-org:service:ContentDirectory:1#Browse"',
    );
    const body = init.body;
    expect(body).toContain("<ObjectID>FV:2</ObjectID>");
    expect(body).toContain("<BrowseFlag>BrowseDirectChildren</BrowseFlag>");
    expect(body).toContain("<Filter>*</Filter>");
    expect(body).toContain("<StartingIndex>0</StartingIndex>");
    expect(body).toContain("<RequestedCount>0</RequestedCount>");
    expect(body).toContain("<SortCriteria></SortCriteria>");
  });

  it("throws if called before connect()", async () => {
    const c = new SonosController();
    await expect(c.getFavorites()).rejects.toThrow(/before connect/);
  });

  it("returns [] for an empty favorites household", async () => {
    const result = await controller.getFavorites();
    expect(result).toEqual([]);
  });
});

describe("SonosController.getFavorites — single-child normalization (AC#1)", () => {
  let controller;
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => okResponse(fixture("browse-fv2-single.xml"))));
    controller = new SonosController().connect("192.168.1.42");
  });

  it("AC#1: a household with exactly one favorite returns an array of length 1", async () => {
    const favorites = await controller.getFavorites();
    expect(Array.isArray(favorites)).toBe(true);
    expect(favorites).toHaveLength(1);
  });

  it("AC#1: the single record has all four fields populated", async () => {
    const [favorite] = await controller.getFavorites();
    expect(favorite.title).toBe("My Playlist");
    expect(favorite.uri).toBe(
      "x-rincon-cpcontainer:1006206cspotify%3aplaylist%3a4U1aR8N5g8sV6IuV3xR9rT",
    );
    expect(favorite.albumArtURI).toBe("/getaa?u=playlist1v1");
    expect(favorite.metadata).toContain("<DIDL-Lite");
    expect(favorite.metadata).toContain("<dc:title>My Playlist</dc:title>");
  });
});

describe("SonosController.getFavorites — mixed favorites (AC#2, #4, #5)", () => {
  let controller;
  let favorites;

  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn(() => okResponse(fixture("browse-fv2-mixed.xml"))));
    controller = new SonosController().connect("192.168.1.42");
    favorites = await controller.getFavorites();
  });

  it("AC#2: 12 mixed items return 12 records", () => {
    expect(favorites).toHaveLength(12);
  });

  it("AC#2: every record has title, uri, metadata, and albumArtURI as non-empty strings", () => {
    for (const fav of favorites) {
      expect(typeof fav.title).toBe("string");
      expect(fav.title.length).toBeGreaterThan(0);
      expect(typeof fav.uri).toBe("string");
      expect(fav.uri.length).toBeGreaterThan(0);
      expect(typeof fav.metadata).toBe("string");
      expect(fav.metadata.length).toBeGreaterThan(0);
      expect(typeof fav.albumArtURI).toBe("string");
      expect(fav.albumArtURI.length).toBeGreaterThan(0);
    }
  });

  it("AC#4: a favorite with x-sonosapi-stream: prefix is returned with prefix intact", () => {
    const radio = favorites.find((f) => f.title === "BBC Radio 1");
    expect(radio).toBeDefined();
    expect(radio.uri.startsWith("x-sonosapi-stream:")).toBe(true);
  });

  it("AC#4: at least one queue container (x-rincon-cpcontainer:) is preserved", () => {
    const container = favorites.find((f) => f.title === "My Spotify Playlist");
    expect(container).toBeDefined();
    expect(container.uri.startsWith("x-rincon-cpcontainer:")).toBe(true);
  });

  it("AC#5: non-ASCII title with em-dash and accented characters round-trips", () => {
    const lana = favorites.find((f) => f.title.startsWith("Lana Del Rey"));
    expect(lana).toBeDefined();
    expect(lana.title).toContain("—"); // U+2014 EM DASH
    expect(lana.title).toContain("There's"); // apostrophe survives

    const cafe = favorites.find((f) => f.title.startsWith("Café"));
    expect(cafe).toBeDefined();
    expect(cafe.title).toBe("Café Tacuba — Re"); // U+00E9 LATIN SMALL E ACUTE + EM DASH
  });
});

describe("SonosController.getFavorites — metadata round-trip preservation (AC#3)", () => {
  let controller;
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => okResponse(fixture("browse-fv2-single.xml"))));
    controller = new SonosController().connect("192.168.1.42");
  });

  it("AC#3: metadata is the raw DIDL-Lite payload of <r:resMD> (not double-escaped, not under-escaped)", async () => {
    const [favorite] = await controller.getFavorites();
    // The metadata must be the SINGLE-unescaped DIDL-Lite content of <r:resMD>
    // (the SOAP transport's xmlEscape will re-escape it on the way out). The
    // structure should be a fully-formed DIDL-Lite document with intact
    // attribute quotes.
    expect(favorite.metadata).toMatch(/^<DIDL-Lite[\s>]/);
    expect(favorite.metadata).toContain('xmlns:dc="http://purl.org/dc/elements/1.1/"');
    expect(favorite.metadata).toContain('parentID="00020000playlist"');
    expect(favorite.metadata).toContain("</DIDL-Lite>");
    // Negative: must not be double-escaped (would mean entity-of-entity made
    // it through unconverted).
    expect(favorite.metadata).not.toContain("&amp;lt;");
    expect(favorite.metadata).not.toContain("&amp;gt;");
  });
});

describe("SonosController.getFavorites — boundary error translation (AC#6)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(Object.assign(new Error("ECONNREFUSED"), { name: "TypeError" }))),
    );
  });

  it("AC#6: a transport failure rejects with a translated user-facing message", async () => {
    const c = new SonosController().connect("192.168.1.42");
    await expect(c.getFavorites()).rejects.toThrow(
      /^Failed to get favorites: Could not reach 192\.168\.1\.42:1400/,
    );
  });

  it("AC#6: the original SonosError is preserved on .cause for diagnostics", async () => {
    const c = new SonosController().connect("192.168.1.42");
    try {
      await c.getFavorites();
      throw new Error("should have thrown");
    } catch (err) {
      expect(err.cause).toBeDefined();
      expect(err.cause.name).toBe("SonosError");
    }
  });
});
