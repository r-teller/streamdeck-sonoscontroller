// @vitest-environment jsdom
//
// h75.6 — per-action SOAP commands. Tests cover:
//   - AC#1 wire-format for every setter and command
//   - AC#2 setVolume(42) → DesiredVolume=42 + Channel=Master at RC URL
//   - AC#3 setLocalTransport sequence (SetAVTransportURI then Play)
//   - AC#4 setServiceURI radio short-circuit (2 POSTs)
//   - AC#5 setServiceURI queue path (5 POSTs in order)
//   - AC#6 getMute parses CurrentMute=1 → true, =0 → false
//   - AC#7 getPositionInfo extracts albumArtURI from embedded TrackMetaData
//   - AC#8 multi-group routing — coord-routed calls hit COORD's host, not bound
//   - AC#9 boundary error — failures throw translated messages

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { SonosController } from "@/modules/common/sonosController.js";
import { convertXmlToJson } from "@/modules/common/xml.js";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures/sonos");
const fixture = (name) => readFileSync(resolve(FIXTURES, name), "utf8");

const okResponse = (body) =>
  Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });

const EMPTY = fixture("soap-empty-response.xml");

// Pre-parse the multi-group topology once for memo injection.
function loadTopologyJson(name) {
  const envelopeXml = fixture(name);
  const env = convertXmlToJson(envelopeXml);
  const stateXml = env?.["s:Body"]?.["u:GetZoneGroupStateResponse"]?.ZoneGroupState ?? "";
  return convertXmlToJson(stateXml);
}

// Fixture topology bindings (for the test bind / coord routing matrix):
// - Office .42  (RINCON_OFFICE01400)        — solo group, self-coord
// - Kitchen .43 (RINCON_KITCHEN01400)       — coord of Kitchen+DiningRoom group
// - DiningRoom .44 (RINCON_DININGROOM01400) — non-coord member of Kitchen group
// - Patio .45   (RINCON_PATIO01400)         — solo group, self-coord
const MULTI_GROUP_TOPOLOGY = loadTopologyJson("zonegroupstate-multi-group.xml");

const URL_AV_KITCHEN = "http://192.168.1.43:1400/MediaRenderer/AVTransport/Control";
const URL_AV_DININGROOM = "http://192.168.1.44:1400/MediaRenderer/AVTransport/Control";
const URL_RC_DININGROOM = "http://192.168.1.44:1400/MediaRenderer/RenderingControl/Control";
const URL_CD_KITCHEN = "http://192.168.1.43:1400/MediaServer/ContentDirectory/Control";

// Test fixture: bind to DiningRoom (non-coord member of multi-member group).
// AV calls should route to Kitchen's host (.43); RC calls should stay on .44.
function makeBoundController() {
  const c = new SonosController().connect("192.168.1.44", { uuid: "RINCON_DININGROOM01400" });
  c._zoneGroupStateMemo = MULTI_GROUP_TOPOLOGY;
  return c;
}

// ─────────────────────────────────────────────────────────────────────
// AC#1 — Setter wire formats (table-driven over the simple cases).
// ─────────────────────────────────────────────────────────────────────

describe("h75.6 setters — wire format (AC#1)", () => {
  let fetchMock;
  let controller;

  beforeEach(() => {
    fetchMock = vi.fn(() => okResponse(EMPTY));
    vi.stubGlobal("fetch", fetchMock);
    controller = makeBoundController();
  });

  // Each row: [method, args, expected URL, expected SOAPAction action, expected
  // body fragments].
  const cases = [
    ["play", [], URL_AV_KITCHEN, "Play", ["<InstanceID>0</InstanceID>", "<Speed>1</Speed>"]],
    ["pause", [], URL_AV_KITCHEN, "Pause", ["<InstanceID>0</InstanceID>"]],
    ["next", [], URL_AV_KITCHEN, "Next", ["<InstanceID>0</InstanceID>"]],
    ["previous", [], URL_AV_KITCHEN, "Previous", ["<InstanceID>0</InstanceID>"]],
    ["setPlayMode", ["SHUFFLE_NOREPEAT"], URL_AV_KITCHEN, "SetPlayMode", ["<NewPlayMode>SHUFFLE_NOREPEAT</NewPlayMode>"]],
    [
      "setAVTransportURI",
      ["x-rincon-queue:RINCON_KITCHEN01400#0"],
      URL_AV_KITCHEN,
      "SetAVTransportURI",
      ["<CurrentURI>x-rincon-queue:RINCON_KITCHEN01400#0</CurrentURI>", "<CurrentURIMetaData></CurrentURIMetaData>"],
    ],
    ["seek", ["TRACK_NR", "1"], URL_AV_KITCHEN, "Seek", ["<Unit>TRACK_NR</Unit>", "<Target>1</Target>"]],
    [
      "addURIToQueue",
      ["x-sonos-spotify:track", ""],
      URL_AV_KITCHEN,
      "AddURIToQueue",
      ["<EnqueuedURI>x-sonos-spotify:track</EnqueuedURI>", "<EnqueueAsNext>1</EnqueueAsNext>"],
    ],
    ["removeAllTracksFromQueue", [], URL_AV_KITCHEN, "RemoveAllTracksFromQueue", ["<InstanceID>0</InstanceID>"]],
    ["setMute", [true], URL_RC_DININGROOM, "SetMute", ["<Channel>Master</Channel>", "<DesiredMute>1</DesiredMute>"]],
    ["setVolume", [42], URL_RC_DININGROOM, "SetVolume", ["<Channel>Master</Channel>", "<DesiredVolume>42</DesiredVolume>"]],
    ["setBass", [-3], URL_RC_DININGROOM, "SetBass", ["<DesiredBass>-3</DesiredBass>"]],
    ["setTreble", [5], URL_RC_DININGROOM, "SetTreble", ["<DesiredTreble>5</DesiredTreble>"]],
  ];

  it.each(cases)(
    "%s POSTs to %s with action %s and the right args",
    async (method, args, expectedUrl, expectedAction, expectedFragments) => {
      await controller[method](...args);
      const calls = fetchMock.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const lastCall = calls[calls.length - 1];
      const [url, init] = lastCall;
      expect(url).toBe(expectedUrl);
      const expectedServiceName = expectedUrl.includes("RenderingControl")
        ? "RenderingControl"
        : "AVTransport";
      expect(init.headers.SOAPAction).toBe(
        `"urn:schemas-upnp-org:service:${expectedServiceName}:1#${expectedAction}"`,
      );
      for (const fragment of expectedFragments) {
        expect(init.body).toContain(fragment);
      }
    },
  );

  // Spot-check Mute=false → DesiredMute=0 (the boolean-to-int rule)
  it("setMute(false) sends DesiredMute=0", async () => {
    await controller.setMute(false);
    expect(fetchMock.mock.calls[0][1].body).toContain("<DesiredMute>0</DesiredMute>");
  });
});

// ─────────────────────────────────────────────────────────────────────
// AC#2 — setVolume specific assertions
// ─────────────────────────────────────────────────────────────────────

describe("h75.6 setVolume (AC#2)", () => {
  let fetchMock;
  let controller;

  beforeEach(() => {
    fetchMock = vi.fn(() => okResponse(EMPTY));
    vi.stubGlobal("fetch", fetchMock);
    controller = makeBoundController();
  });

  it("AC#2: setVolume(42) — envelope contains DesiredVolume=42 and Channel=Master, URL is RC", async () => {
    await controller.setVolume(42);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(URL_RC_DININGROOM);
    expect(init.body).toContain("<DesiredVolume>42</DesiredVolume>");
    expect(init.body).toContain("<Channel>Master</Channel>");
  });
});

// ─────────────────────────────────────────────────────────────────────
// AC#3 — setLocalTransport sequence
// ─────────────────────────────────────────────────────────────────────

describe("h75.6 setLocalTransport (AC#3)", () => {
  let fetchMock;
  let controller;

  beforeEach(() => {
    fetchMock = vi.fn(() => okResponse(EMPTY));
    vi.stubGlobal("fetch", fetchMock);
    controller = makeBoundController();
  });

  it("AC#3: issues SetAVTransportURI then Play, with URI built as <prefix>:<COORD_UUID><suffix>", async () => {
    await controller.setLocalTransport("x-rincon-stream", "");

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [url1, init1] = fetchMock.mock.calls[0];
    expect(url1).toBe(URL_AV_KITCHEN);
    expect(init1.headers.SOAPAction).toBe(
      '"urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI"',
    );
    expect(init1.body).toContain(
      "<CurrentURI>x-rincon-stream:RINCON_KITCHEN01400</CurrentURI>",
    );

    const [url2, init2] = fetchMock.mock.calls[1];
    expect(url2).toBe(URL_AV_KITCHEN);
    expect(init2.headers.SOAPAction).toBe(
      '"urn:schemas-upnp-org:service:AVTransport:1#Play"',
    );
  });

  it("setLocalTransport with TV suffix — URI is <prefix>:<coord>:spdif", async () => {
    await controller.setLocalTransport("x-sonos-htastream", ":spdif");
    const init1 = fetchMock.mock.calls[0][1];
    expect(init1.body).toContain(
      "<CurrentURI>x-sonos-htastream:RINCON_KITCHEN01400:spdif</CurrentURI>",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────
// AC#4 — setServiceURI radio short-circuit (2 POSTs)
// ─────────────────────────────────────────────────────────────────────

describe("h75.6 setServiceURI radio (AC#4)", () => {
  let fetchMock;
  let controller;

  beforeEach(() => {
    fetchMock = vi.fn(() => okResponse(EMPTY));
    vi.stubGlobal("fetch", fetchMock);
    controller = makeBoundController();
  });

  it("AC#4: x-sonosapi-stream: URI → exactly 2 POSTs (SetAVTransportURI + Play). No queue calls.", async () => {
    const radioFavorite = {
      uri: "x-sonosapi-stream:s12345?sid=254",
      metadata:
        '<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/"><item><dc:title>Lo-Fi Radio</dc:title></item></DIDL-Lite>',
      title: "Lo-Fi Radio",
      albumArtURI: "/getaa?u=lofi",
    };

    await controller.setServiceURI(radioFavorite);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const actions = fetchMock.mock.calls.map((c) => {
      const m = c[1].headers.SOAPAction.match(/#(\w+)"/);
      return m?.[1];
    });
    expect(actions).toEqual(["SetAVTransportURI", "Play"]);

    // Metadata is passed verbatim (xmlEscape converts < and > on the wire,
    // so the OUTGOING body has the escaped form of the metadata)
    const body = fetchMock.mock.calls[0][1].body;
    expect(body).toContain("<CurrentURI>x-sonosapi-stream:s12345?sid=254</CurrentURI>");
    expect(body).toContain("&lt;dc:title&gt;Lo-Fi Radio&lt;/dc:title&gt;");
  });
});

// ─────────────────────────────────────────────────────────────────────
// AC#5 — setServiceURI queue path (5 POSTs in order)
// ─────────────────────────────────────────────────────────────────────

describe("h75.6 setServiceURI queue (AC#5)", () => {
  let fetchMock;
  let controller;

  beforeEach(() => {
    fetchMock = vi.fn(() => okResponse(EMPTY));
    vi.stubGlobal("fetch", fetchMock);
    controller = makeBoundController();
  });

  it("AC#5: x-rincon-cpcontainer URI → 5 POSTs in order: RemoveAll, AddURI, SetAV, Seek, Play", async () => {
    const queueFavorite = {
      uri: "x-rincon-cpcontainer:1006206cspotify%3aplaylist%3aXYZ",
      metadata: "<DIDL-Lite>metadata-payload</DIDL-Lite>",
      title: "My Spotify Playlist",
      albumArtURI: "/getaa?u=playlist",
    };

    await controller.setServiceURI(queueFavorite);

    expect(fetchMock).toHaveBeenCalledTimes(5);

    const actions = fetchMock.mock.calls.map((c) => {
      const m = c[1].headers.SOAPAction.match(/#(\w+)"/);
      return m?.[1];
    });
    expect(actions).toEqual([
      "RemoveAllTracksFromQueue",
      "AddURIToQueue",
      "SetAVTransportURI",
      "Seek",
      "Play",
    ]);

    // AddURIToQueue carries URI + metadata verbatim
    const addBody = fetchMock.mock.calls[1][1].body;
    expect(addBody).toContain(
      "<EnqueuedURI>x-rincon-cpcontainer:1006206cspotify%3aplaylist%3aXYZ</EnqueuedURI>",
    );
    expect(addBody).toContain("&lt;DIDL-Lite&gt;metadata-payload&lt;/DIDL-Lite&gt;");

    // SetAVTransportURI uses the COORDINATOR's UUID for the queue URI
    const setAvBody = fetchMock.mock.calls[2][1].body;
    expect(setAvBody).toContain("<CurrentURI>x-rincon-queue:RINCON_KITCHEN01400#0</CurrentURI>");

    // Seek uses TRACK_NR + Target=1
    const seekBody = fetchMock.mock.calls[3][1].body;
    expect(seekBody).toContain("<Unit>TRACK_NR</Unit>");
    expect(seekBody).toContain("<Target>1</Target>");
  });
});

// ─────────────────────────────────────────────────────────────────────
// AC#6 — getMute parses CurrentMute → boolean
// ─────────────────────────────────────────────────────────────────────

describe("h75.6 getMute parsing (AC#6)", () => {
  it("AC#6: CurrentMute=1 → true", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okResponse(fixture("getmute-response.xml"))));
    const c = new SonosController().connect("192.168.1.44", { uuid: "RINCON_DININGROOM01400" });
    expect(await c.getMute()).toBe(true);
  });

  it("AC#6: CurrentMute=0 → false", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okResponse(fixture("getmute-unmuted-response.xml"))));
    const c = new SonosController().connect("192.168.1.44", { uuid: "RINCON_DININGROOM01400" });
    expect(await c.getMute()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// AC#7 — getPositionInfo metadata extraction
// ─────────────────────────────────────────────────────────────────────

describe("h75.6 getPositionInfo (AC#7)", () => {
  it("AC#7: returns PlayingInfo-shaped object with albumArtURI from embedded TrackMetaData", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => okResponse(fixture("getpositioninfo-spotify-track.xml"))),
    );
    const c = makeBoundController();

    const info = await c.getPositionInfo();
    expect(info.title).toBe("Anti-Hero");
    expect(info.artist).toBe("Taylor Swift");
    expect(info.album).toBe("Midnights");
    expect(info.albumArtURI).toBe("/getaa?u=spotify_track1");
    expect(info.trackDuration).toBe("0:03:42");
    expect(info.relTime).toBe("0:01:23");
    expect(info.track).toBe(3);
    expect(info.trackURI).toBe("x-sonos-spotify:track1");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Other getter parsing tests
// ─────────────────────────────────────────────────────────────────────

describe("h75.6 getter parsing", () => {
  it("getVolume parses CurrentVolume → number", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okResponse(fixture("soap-getvolume-response.xml"))));
    const c = new SonosController().connect("192.168.1.44", { uuid: "RINCON_DININGROOM01400" });
    expect(await c.getVolume()).toBe(42);
  });

  it("getBass parses CurrentBass → number (handles negatives)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okResponse(fixture("getbass-response.xml"))));
    const c = new SonosController().connect("192.168.1.44", { uuid: "RINCON_DININGROOM01400" });
    expect(await c.getBass()).toBe(-3);
  });

  it("getTreble parses CurrentTreble → number", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okResponse(fixture("gettreble-response.xml"))));
    const c = new SonosController().connect("192.168.1.44", { uuid: "RINCON_DININGROOM01400" });
    expect(await c.getTreble()).toBe(5);
  });

  it("getTransportSettings parses PlayMode", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => okResponse(fixture("gettransportsettings-shuffle.xml"))),
    );
    const c = makeBoundController();
    expect(await c.getTransportSettings()).toEqual({ playMode: "SHUFFLE_NOREPEAT" });
  });

  it("getTransportInfo returns playbackState/status/speed (PLAYING)", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okResponse(fixture("gettransportinfo-playing.xml"))));
    const c = makeBoundController();
    const info = await c.getTransportInfo();
    expect(info.playbackState).toBe("PLAYING");
    expect(info.currentTransportStatus).toBe("OK");
    expect(info.currentSpeed).toBe("1");
  });

  it("getTransportInfo returns playbackState=PAUSED_PLAYBACK", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okResponse(fixture("gettransportinfo-paused.xml"))));
    const c = makeBoundController();
    const info = await c.getTransportInfo();
    expect(info.playbackState).toBe("PAUSED_PLAYBACK");
  });
});

// ─────────────────────────────────────────────────────────────────────
// getQueue
// ─────────────────────────────────────────────────────────────────────

describe("h75.6 getQueue", () => {
  let fetchMock;
  let controller;

  beforeEach(() => {
    controller = makeBoundController();
  });

  it("empty queue returns {start:0, count:0, list:[]}", async () => {
    fetchMock = vi.fn(() => okResponse(fixture("browse-q0-empty.xml")));
    vi.stubGlobal("fetch", fetchMock);
    const result = await controller.getQueue();
    expect(result.list).toEqual([]);
    expect(result.count).toBe(0);
  });

  it("five-track queue returns 5 records with title/artist/album/uri/albumArtURI", async () => {
    fetchMock = vi.fn(() => okResponse(fixture("browse-q0-five-tracks.xml")));
    vi.stubGlobal("fetch", fetchMock);
    const result = await controller.getQueue();
    expect(result.list).toHaveLength(5);
    expect(result.count).toBe(5);
    expect(result.list[0]).toMatchObject({
      title: "Track One",
      artist: "Artist A",
      album: "Album One",
      uri: "x-sonos-spotify:track1",
      albumArtURI: "/getaa?u=track1",
    });
    expect(result.list[4].title).toBe("Track Five");
  });

  it("getQueue routes to coordinator (not bound speaker)", async () => {
    fetchMock = vi.fn(() => okResponse(fixture("browse-q0-empty.xml")));
    vi.stubGlobal("fetch", fetchMock);
    await controller.getQueue();
    expect(fetchMock.mock.calls[0][0]).toBe(URL_CD_KITCHEN);
  });

  it("getQueue passes startIndex / requestedCount through to Browse args", async () => {
    fetchMock = vi.fn(() => okResponse(fixture("browse-q0-empty.xml")));
    vi.stubGlobal("fetch", fetchMock);
    await controller.getQueue({ startIndex: 5, requestedCount: 10 });
    const body = fetchMock.mock.calls[0][1].body;
    expect(body).toContain("<StartingIndex>5</StartingIndex>");
    expect(body).toContain("<RequestedCount>10</RequestedCount>");
    expect(body).toContain("<ObjectID>Q:0</ObjectID>");
  });
});

// ─────────────────────────────────────────────────────────────────────
// AC#8 — Multi-group routing
// ─────────────────────────────────────────────────────────────────────

describe("h75.6 multi-group coordinator routing (AC#8)", () => {
  it("AC#8: bound speaker is non-coord member → AVTransport calls hit COORD's host, not bound's", async () => {
    const fetchMock = vi.fn(() => okResponse(EMPTY));
    vi.stubGlobal("fetch", fetchMock);
    const c = makeBoundController(); // bound to .44 (DiningRoom), coord is .43 (Kitchen)

    await c.play();

    expect(fetchMock.mock.calls[0][0]).toBe(URL_AV_KITCHEN);
    expect(fetchMock.mock.calls[0][0]).not.toBe(URL_AV_DININGROOM);
  });

  it("AC#8: bound speaker IS coord → AVTransport calls hit bound's host (self)", async () => {
    const fetchMock = vi.fn(() => okResponse(EMPTY));
    vi.stubGlobal("fetch", fetchMock);
    const c = new SonosController().connect("192.168.1.43", { uuid: "RINCON_KITCHEN01400" });
    c._zoneGroupStateMemo = MULTI_GROUP_TOPOLOGY;

    await c.play();
    expect(fetchMock.mock.calls[0][0]).toBe(URL_AV_KITCHEN);
  });

  it("RC calls always hit bound speaker (not coord) — volume/mute/eq are per-speaker", async () => {
    const fetchMock = vi.fn(() => okResponse(EMPTY));
    vi.stubGlobal("fetch", fetchMock);
    const c = makeBoundController();
    await c.setVolume(50);
    expect(fetchMock.mock.calls[0][0]).toBe(URL_RC_DININGROOM);
  });

  it("coord-routed call without boundUuid throws a useful error", async () => {
    vi.stubGlobal("fetch", vi.fn(() => okResponse(EMPTY)));
    const c = new SonosController().connect("192.168.1.42"); // no uuid
    await expect(c.play()).rejects.toThrow(/boundUuid not set/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// AC#9 — Boundary translation: failures surface translated messages
// ─────────────────────────────────────────────────────────────────────

describe("h75.6 boundary error translation (AC#9)", () => {
  it("AC#9: setVolume on a host that refuses connection → translated 'Could not reach' message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.reject(Object.assign(new Error("ECONNREFUSED"), { name: "TypeError" })),
      ),
    );
    const c = new SonosController().connect("192.168.1.44", { uuid: "RINCON_DININGROOM01400" });
    await expect(c.setVolume(50)).rejects.toThrow(
      /^Failed to set volume: Could not reach 192\.168\.1\.44:1400/,
    );
  });

  it("AC#9: play() with an offline coord → translated message; original SonosError on .cause", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.reject(Object.assign(new Error("ECONNREFUSED"), { name: "TypeError" })),
      ),
    );
    const c = makeBoundController();
    try {
      await c.play();
      throw new Error("should have thrown");
    } catch (err) {
      expect(err.message).toMatch(/^Failed to play: Could not reach/);
      expect(err.cause?.name).toBe("SonosError");
    }
  });

  it("AC#9: getMute SOAP fault → translated 'Sonos returned error' message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          text: () => Promise.resolve(fixture("soap-fault-401.xml")),
        }),
      ),
    );
    const c = new SonosController().connect("192.168.1.44", { uuid: "RINCON_DININGROOM01400" });
    await expect(c.getMute()).rejects.toThrow(/^Failed to get mute: Sonos returned error/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// getHostByUuid + _coordServiceFor unit tests
// ─────────────────────────────────────────────────────────────────────

describe("h75.6 getHostByUuid", () => {
  it("returns the host for a primary ZoneGroupMember", () => {
    expect(SonosController.getHostByUuid(MULTI_GROUP_TOPOLOGY, "RINCON_KITCHEN01400")).toBe(
      "192.168.1.43",
    );
  });

  it("returns the host for a satellite (different fixture)", () => {
    const stereoTopology = loadTopologyJson("zonegroupstate-stereo-pair.xml");
    expect(SonosController.getHostByUuid(stereoTopology, "RINCON_BEDROOM01401")).toBe(
      "192.168.1.51",
    );
  });

  it("returns '' for an unknown UUID", () => {
    expect(SonosController.getHostByUuid(MULTI_GROUP_TOPOLOGY, "RINCON_GHOST")).toBe("");
  });

  it("returns '' for null/undefined inputs", () => {
    expect(SonosController.getHostByUuid(null, "x")).toBe("");
    expect(SonosController.getHostByUuid({}, null)).toBe("");
  });
});
