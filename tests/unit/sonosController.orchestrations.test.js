// @vitest-environment jsdom
import { describe, test, expect, vi, afterEach } from "vitest";
import { SonosController } from "@/modules/common/sonosController.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const fixture = (name) => readFileSync(join(process.cwd(), "tests/fixtures/sonos", name), "utf8");

describe("SonosController orchestrations", () => {
  let fetchStub;
  let controller;

  const zoneGroupStateSingle = fixture("zonegroupstate-single-group-single-member.xml");
  const soapEmptyResponse = fixture("soap-empty-response.xml");

  const actionOf = (body) => (body.match(/<u:([A-Za-z]+)[ >]/) || [])[1];

  const mockFetch = (responses = {}) => {
    fetchStub = vi.fn(async (url, opts) => {
      const body = opts?.body || "";
      const action = actionOf(body);

      if (body.includes("GetZoneGroupState")) {
        return { ok: true, status: 200, text: async () => zoneGroupStateSingle };
      }

      if (responses[action]) {
        return { ok: true, status: 200, text: async () => responses[action] };
      }

      return { ok: true, status: 200, text: async () => soapEmptyResponse };
    });

    globalThis.fetch = fetchStub;
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("setServiceURI radio branch: exactly 2 AVTransport calls (SetAVTransportURI then Play)", async () => {
    mockFetch({});
    controller = new SonosController().connect("192.168.1.42", { uuid: "RINCON_OFFICE01400" });

    const uri = "x-sonosapi-stream:s12345?sid=254";
    const metadata = "<DIDL-Lite>radio</DIDL-Lite>";

    await controller.setServiceURI({ uri, metadata });

    const allCalls = fetchStub.mock.calls.map((c) => ({ body: c[1]?.body || "" }));
    const transportCalls = allCalls.filter((c) => !c.body.includes("GetZoneGroupState"));
    expect(transportCalls.length).toBe(2);

    const firstBody = transportCalls[0].body;
    const secondBody = transportCalls[1].body;

    expect(actionOf(firstBody)).toBe("SetAVTransportURI");
    expect(firstBody).toContain(`<CurrentURI>${uri}</CurrentURI>`);
    expect(firstBody).toContain(`&lt;DIDL-Lite&gt;radio&lt;/DIDL-Lite&gt;`);
    expect(actionOf(secondBody)).toBe("Play");
  });

  test("setServiceURI queue branch: exactly 5 AVTransport calls in correct order", async () => {
    mockFetch({});
    controller = new SonosController().connect("192.168.1.42", { uuid: "RINCON_OFFICE01400" });

    const uri = "x-sonos-spotify:track999";
    const metadata = "";

    await controller.setServiceURI({ uri, metadata });

    const allCalls = fetchStub.mock.calls.map((c) => ({ body: c[1]?.body || "" }));
    const transportCalls = allCalls.filter((c) => !c.body.includes("GetZoneGroupState"));
    expect(transportCalls.length).toBe(5);

    const bodies = transportCalls.map((c) => c.body);
    const actions = bodies.map(actionOf);

    expect(actions).toEqual(["RemoveAllTracksFromQueue", "AddURIToQueue", "SetAVTransportURI", "Seek", "Play"]);

    expect(actionOf(bodies[1])).toBe("AddURIToQueue");
    expect(bodies[1]).toContain("<EnqueuedURI>x-sonos-spotify:track999</EnqueuedURI>");
    expect(actionOf(bodies[2])).toBe("SetAVTransportURI");
    expect(bodies[2]).toContain("<CurrentURI>x-rincon-queue:RINCON_OFFICE01400#0</CurrentURI>");
    expect(actionOf(bodies[3])).toBe("Seek");
    expect(bodies[3]).toContain("<Unit>TRACK_NR</Unit>");
    expect(bodies[3]).toContain("<Target>1</Target>");
  });

  test("setLocalTransport('x-rincon-stream', '') builds correct URI and plays", async () => {
    mockFetch({});
    controller = new SonosController().connect("192.168.1.42", { uuid: "RINCON_OFFICE01400" });

    await controller.setLocalTransport("x-rincon-stream", "");

    const allCalls = fetchStub.mock.calls.map((c) => ({ body: c[1]?.body || "" }));
    const transportCalls = allCalls.filter((c) => !c.body.includes("GetZoneGroupState"));
    expect(transportCalls.length).toBe(2);

    const firstBody = transportCalls[0].body;
    expect(actionOf(firstBody)).toBe("SetAVTransportURI");
    expect(firstBody).toContain("<CurrentURI>x-rincon-stream:RINCON_OFFICE01400</CurrentURI>");

    const secondBody = transportCalls[1].body;
    expect(actionOf(secondBody)).toBe("Play");
  });

  test("setLocalTransport('x-sonos-htastream', ':spdif') builds correct URI", async () => {
    mockFetch({});
    controller = new SonosController().connect("192.168.1.42", { uuid: "RINCON_OFFICE01400" });

    await controller.setLocalTransport("x-sonos-htastream", ":spdif");

    const allCalls = fetchStub.mock.calls.map((c) => ({ body: c[1]?.body || "" }));
    const transportCalls = allCalls.filter((c) => !c.body.includes("GetZoneGroupState"));
    expect(transportCalls.length).toBe(2);

    const firstBody = transportCalls[0].body;
    expect(actionOf(firstBody)).toBe("SetAVTransportURI");
    expect(firstBody).toContain("<CurrentURI>x-sonos-htastream:RINCON_OFFICE01400:spdif</CurrentURI>");

    const secondBody = transportCalls[1].body;
    expect(actionOf(secondBody)).toBe("Play");
  });

  test("getPositionInfo() parses metadata correctly", async () => {
    mockFetch({
      GetPositionInfo: fixture("getpositioninfo-spotify-track.xml"),
    });
    controller = new SonosController().connect("192.168.1.42", { uuid: "RINCON_OFFICE01400" });

    const info = await controller.getPositionInfo();

    expect(info).toEqual({
      track: 3,
      trackDuration: "0:03:42",
      trackURI: "x-sonos-spotify:track1",
      relTime: "0:01:23",
      absTime: "NOT_IMPLEMENTED",
      title: "Anti-Hero",
      artist: "Taylor Swift",
      album: "Midnights",
      albumArtURI: "http://192.168.1.42:1400/getaa?u=spotify_track1",
    });
  });

  test("getPositionInfo() degrades malformed track metadata to empty fields (sonos-9b0)", async () => {
    const malformed = fixture("getpositioninfo-spotify-track.xml").replace(
      /<TrackMetaData>.*<\/TrackMetaData>/s,
      "<TrackMetaData>&lt;DIDL-Lite&gt;&lt;item&gt;&lt;dc:title&gt;Broken</TrackMetaData>",
    );
    mockFetch({ GetPositionInfo: malformed });
    controller = new SonosController().connect("192.168.1.42", { uuid: "RINCON_OFFICE01400" });

    const info = await controller.getPositionInfo();

    expect(info).toMatchObject({
      trackURI: "x-sonos-spotify:track1",
      relTime: "0:01:23",
      title: "",
      artist: "",
      album: "",
      albumArtURI: "",
    });
  });

  test("transport getters return typed defaults for an empty response (sonos-va7)", async () => {
    mockFetch({});
    controller = new SonosController().connect("192.168.1.42", { uuid: "RINCON_OFFICE01400" });

    expect(await controller.getTransportSettings()).toEqual({ playMode: "" });
    expect(await controller.getTransportInfo()).toEqual({
      playbackState: "",
      currentTransportStatus: "",
      currentSpeed: "",
    });
    const position = await controller.getPositionInfo();
    expect(position.track).toBe(0);
    expect(position.trackURI).toBe("");
  });

  test("getTransportInfo() returns correct state for PLAYING", async () => {
    mockFetch({
      GetTransportInfo: fixture("gettransportinfo-playing.xml"),
    });
    controller = new SonosController().connect("192.168.1.42", { uuid: "RINCON_OFFICE01400" });

    const info = await controller.getTransportInfo();

    expect(info).toEqual({
      playbackState: "PLAYING",
      currentTransportStatus: "OK",
      currentSpeed: "1",
    });
  });

  test("getTransportInfo() returns correct state for PAUSED_PLAYBACK", async () => {
    mockFetch({
      GetTransportInfo: fixture("gettransportinfo-paused.xml"),
    });
    controller = new SonosController().connect("192.168.1.42", { uuid: "RINCON_OFFICE01400" });

    const info = await controller.getTransportInfo();

    expect(info.playbackState).toBe("PAUSED_PLAYBACK");
  });

  test("getTransportInfo() reports TRANSITIONING (just after Play) as PLAYING", async () => {
    mockFetch({
      GetTransportInfo: fixture("gettransportinfo-transitioning.xml"),
    });
    controller = new SonosController().connect("192.168.1.42", { uuid: "RINCON_OFFICE01400" });

    const info = await controller.getTransportInfo();

    expect(info.playbackState).toBe("PLAYING");
  });

  test("getTransportSettings() returns playMode", async () => {
    mockFetch({
      GetTransportSettings: fixture("gettransportsettings-shuffle.xml"),
    });
    controller = new SonosController().connect("192.168.1.42", { uuid: "RINCON_OFFICE01400" });

    const settings = await controller.getTransportSettings();

    expect(settings).toEqual({ playMode: "SHUFFLE_NOREPEAT" });
  });

  test("getMute() returns true when muted", async () => {
    mockFetch({
      GetMute: fixture("getmute-response.xml"),
    });
    controller = new SonosController().connect("192.168.1.42", { uuid: "RINCON_OFFICE01400" });

    const muted = await controller.getMute();

    expect(muted).toBe(true);
  });

  test("getMute() returns false when unmuted", async () => {
    mockFetch({
      GetMute: fixture("getmute-unmuted-response.xml"),
    });
    controller = new SonosController().connect("192.168.1.42", { uuid: "RINCON_OFFICE01400" });

    const muted = await controller.getMute();

    expect(muted).toBe(false);
  });

  test("getVolume() returns a number", async () => {
    mockFetch({
      GetVolume: fixture("soap-getvolume-response.xml"),
    });
    controller = new SonosController().connect("192.168.1.42", { uuid: "RINCON_OFFICE01400" });

    const volume = await controller.getVolume();

    expect(typeof volume).toBe("number");
  });

  test("getBass() returns -3", async () => {
    mockFetch({
      GetBass: fixture("getbass-response.xml"),
    });
    controller = new SonosController().connect("192.168.1.42", { uuid: "RINCON_OFFICE01400" });

    const bass = await controller.getBass();

    expect(bass).toBe(-3);
  });

  test("getTreble() returns 5", async () => {
    mockFetch({
      GetTreble: fixture("gettreble-response.xml"),
    });
    controller = new SonosController().connect("192.168.1.42", { uuid: "RINCON_OFFICE01400" });

    const treble = await controller.getTreble();

    expect(treble).toBe(5);
  });
});
