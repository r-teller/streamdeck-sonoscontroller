import path from "node:path";
import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { mockStreamDeckHostSource, createMockHost, connect } from "./support/mockStreamDeckHost.js";
import { installMockSonos } from "./support/mockSonos.js";
import { waitForPollAfter } from "./support/polling.js";

const GETTER_FIXTURES = {
  GetTransportInfo: "gettransportinfo-playing.xml",
  GetTransportSettings: "gettransportsettings-shuffle.xml",
  GetMute: "getmute-unmuted-response.xml",
  GetVolume: "soap-getvolume-response.xml",
  GetBass: "getbass-response.xml",
  GetTreble: "gettreble-response.xml",
  GetPositionInfo: "getpositioninfo-spotify-track.xml",
};

async function commonSetup(page, mockOptions = {}) {
  const defaultOptions = { topologyFixture: "zonegroupstate-single-group-single-member.xml" };
  const mock = await installMockSonos(page, { ...defaultOptions, ...mockOptions });
  await page.addInitScript(mockStreamDeckHostSource);
  await page.goto("/plugin.html");
  const mockHost = createMockHost(page);
  await connect(page, { uuid: "plugin-uuid-p5", registerEvent: "registerPlugin", actionInfo: null });
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(err.message));
  return { mock, mockHost, consoleErrors };
}

test.beforeAll(async () => {
  const PLUGIN_HTML = path.resolve("com.r-teller.sonoscontroller.sdPlugin/plugin.html");
  expect(fs.existsSync(PLUGIN_HTML)).toBeTruthy();
});

test.describe("p5 - Sonos Stream Deck plugin end-to-end scenarios", () => {
  test("p5-toggle-mute", async ({ page }) => {
    const { mock, mockHost, consoleErrors } = await commonSetup(page, {
      actionFixtures: { ...GETTER_FIXTURES },
    });

    const ctx1 = "ctx1";
    const settings = {
      uuid: "RINCON_OFFICE01400",
      hostAddress: "192.168.1.42",
      zoneName: "Office",
      displayStateBasedTitle: true,
    };

    await mockHost.inject.willAppear(ctx1, "com.r-teller.sonoscontroller.toggle-mute-unmute", settings);
    // Wait for initial poll (GetMute call)
    await expect.poll(() => mock.calls.filter((c) => c.action === "GetMute").length, { timeout: 8000 }).toBeGreaterThan(0);
    // Expect setTitle "Unmuted" frame
    const initialFrames = await mockHost.outbound();
    expect(
      initialFrames.filter((f) => f.event === "setTitle" && f.context === ctx1 && f.payload.title === "Unmuted").length,
    ).toBeGreaterThan(0);

    // Press key
    await mockHost.inject.keyDown(ctx1);

    // Expect SetMute call
    await expect.poll(() => mock.calls.filter((c) => c.action === "SetMute").length, { timeout: 8000 }).toBeGreaterThan(0);
    const setMuteCall = mock.calls.find((c) => c.action === "SetMute");
    expect(setMuteCall.body).toContain("<DesiredMute>1</DesiredMute>");

    // Expect optimistic setState (state=1) and setTitle "Muted"
    await expect
      .poll(
        async () =>
          (await mockHost.outbound()).filter((f) => f.event === "setTitle" && f.context === ctx1 && f.payload.title === "Muted")
            .length,
        { timeout: 8000 },
      )
      .toBeGreaterThan(0);
    const optimisticFrames = await mockHost.outbound();
    const setStateFrames = optimisticFrames.filter((f) => f.event === "setState" && f.context === ctx1);
    expect(setStateFrames.length).toBeGreaterThanOrEqual(1);
    expect(setStateFrames[setStateFrames.length - 1].payload.state).toBe(1);

    const setTitleFrames = optimisticFrames.filter((f) => f.event === "setTitle" && f.context === ctx1);
    expect(setTitleFrames.length).toBeGreaterThanOrEqual(1);
    expect(setTitleFrames[setTitleFrames.length - 1].payload.title).toBe("Muted");

    // Verify GetMute count is still 1 (optimistic, not poll-driven)
    const getMuteCalls = mock.calls.filter((c) => c.action === "GetMute");
    expect(getMuteCalls.length).toBe(1);

    // Confirm state sticks after poll (must run BEFORE leaving plugin.html —
    // navigating to the preview page tears down the plugin runtime)
    await mock.setActionFixture("GetMute", "getmute-response.xml");
    await mockHost.inject.globalSettings({ deviceCheckInterval: 1 });
    await expect.poll(() => mock.calls.filter((c) => c.action === "GetMute").length, { timeout: 8000 }).toBeGreaterThan(1);
    await page.waitForTimeout(1200);

    // Ensure no state=0 frame was emitted after the press
    const allFrames = await mockHost.outbound();
    const setStateFramesAfter = allFrames.filter((f) => f.event === "setState" && f.context === ctx1);
    const state1Index = setStateFramesAfter.findIndex((f) => f.payload.state === 1);
    const lastState0Index = setStateFramesAfter.map((f) => f.payload.state).lastIndexOf(0);
    expect(state1Index).toBeGreaterThanOrEqual(0);
    expect(lastState0Index).toBeLessThan(state1Index);

    // Render preview and screenshot (optimistic snapshot captured earlier)
    await page.goto("/harness/key-preview.html");
    const frames = optimisticFrames.filter((f) => ["setTitle", "setState", "setImage"].includes(f.event));
    await page.evaluate((f) => window.renderFrames(f), frames);
    await page.screenshot({ path: "tests/playwright/screenshots/p5-mute-optimistic.png", fullPage: true });

    expect(consoleErrors.filter((e) => !e.includes("net::ERR"))).toEqual([]);
  });

  test("p5-optimistic-rollback", async ({ page }) => {
    const { mock, mockHost, consoleErrors } = await commonSetup(page, {
      actionFixtures: { ...GETTER_FIXTURES },
    });

    const ctx1 = "ctx1";
    const settings = {
      uuid: "RINCON_OFFICE01400",
      hostAddress: "192.168.1.42",
      zoneName: "Office",
      displayStateBasedTitle: true,
    };

    await mockHost.inject.willAppear(ctx1, "com.r-teller.sonoscontroller.toggle-mute-unmute", settings);
    await expect.poll(() => mock.calls.filter((c) => c.action === "GetMute").length, { timeout: 8000 }).toBeGreaterThan(0);
    await mockHost.clearOutbound();

    // Press key
    await mockHost.inject.keyDown(ctx1);

    // Expect optimistic setState (state=1)
    await expect
      .poll(
        async () =>
          (await mockHost.outbound()).filter((f) => f.event === "setState" && f.context === ctx1 && f.payload.state === 1)
            .length,
        { timeout: 8000 },
      )
      .toBeGreaterThan(0);
    const optimisticFrames = await mockHost.outbound();
    const state1Frames = optimisticFrames.filter((f) => f.event === "setState" && f.context === ctx1 && f.payload.state === 1);
    expect(state1Frames.length).toBeGreaterThanOrEqual(1);

    // Now simulate rollback: change fixture to unmuted (0), wait for re-poll
    await mock.setActionFixture("GetMute", "getmute-unmuted-response.xml");
    await mockHost.inject.globalSettings({ deviceCheckInterval: 1 });
    await expect.poll(() => mock.calls.filter((c) => c.action === "GetMute").length, { timeout: 8000 }).toBeGreaterThan(1);
    await page.waitForTimeout(1200);

    // Expect rollback setState (state=0)
    await expect
      .poll(
        async () =>
          (await mockHost.outbound()).filter((f) => f.event === "setState" && f.context === ctx1 && f.payload.state === 0)
            .length,
        { timeout: 8000 },
      )
      .toBeGreaterThan(0);
    const rollbackFrames = await mockHost.outbound();
    const state0Frames = rollbackFrames.filter((f) => f.event === "setState" && f.context === ctx1 && f.payload.state === 0);
    expect(state0Frames.length).toBeGreaterThanOrEqual(1);

    // Verify order: state=1 frame index < state=0 frame index
    const allFrames = await mockHost.outbound();
    const setStateFrames = allFrames.filter((f) => f.event === "setState" && f.context === ctx1);
    const state1Index = setStateFrames.findIndex((f) => f.payload.state === 1);
    const state0Index = setStateFrames.findIndex((f) => f.payload.state === 0);
    expect(state1Index).toBeGreaterThanOrEqual(0);
    expect(state0Index).toBeGreaterThanOrEqual(0);
    expect(state0Index).toBeGreaterThan(state1Index);

    expect(consoleErrors.filter((e) => !e.includes("net::ERR"))).toEqual([]);
  });

  test("p5-play-pause-3state", async ({ page }) => {
    const { mock, mockHost, consoleErrors } = await commonSetup(page, {
      actionFixtures: {
        ...GETTER_FIXTURES,
        GetTransportInfo: "gettransportinfo-playing.xml",
      },
    });

    const ctx1 = "ctx1";
    const settings = {
      uuid: "RINCON_OFFICE01400",
      hostAddress: "192.168.1.42",
      zoneName: "Office",
      displayStateBasedTitle: true,
    };

    await mockHost.inject.globalSettings({ deviceCheckInterval: 1 });
    // Phase A: Playing
    await mockHost.inject.willAppear(ctx1, "com.r-teller.sonoscontroller.toggle-play-pause", settings);
    await expect
      .poll(
        async () =>
          (await mockHost.outbound()).filter((f) => f.event === "setTitle" && f.context === ctx1).pop()?.payload?.title,
        { timeout: 8000 },
      )
      .toBe("Playing");
    await expect
      .poll(() => mock.calls.filter((c) => c.action === "GetTransportInfo").length, { timeout: 8000 })
      .toBeGreaterThan(0);
    const playingFrames = await mockHost.outbound();
    const playingSetTitle = playingFrames.filter((f) => f.event === "setTitle" && f.context === ctx1).pop();
    expect(playingSetTitle.payload.title).toBe("Playing");
    const playingState = playingFrames.filter((f) => f.event === "setState" && f.context === ctx1).pop();
    expect(playingState.payload.state).toBe(1);

    // Phase B: Paused (via fixture swap)
    await mock.setActionFixture("GetTransportInfo", "gettransportinfo-paused.xml");
    await expect
      .poll(
        async () =>
          (await mockHost.outbound()).filter((f) => f.event === "setTitle" && f.context === ctx1).pop()?.payload?.title,
        { timeout: 8000 },
      )
      .toBe("Paused");
    await expect
      .poll(() => mock.calls.filter((c) => c.action === "GetTransportInfo").length, { timeout: 8000 })
      .toBeGreaterThan(1);
    const pausedFrames = await mockHost.outbound();
    const pausedSetTitle = pausedFrames.filter((f) => f.event === "setTitle" && f.context === ctx1).pop();
    expect(pausedSetTitle.payload.title).toBe("Paused");
    const pausedState = pausedFrames.filter((f) => f.event === "setState" && f.context === ctx1).pop();
    expect(pausedState.payload.state).toBe(0);

    // Phase C: Stopped (via fixture swap)
    await mock.setActionFixture("GetTransportInfo", "gettransportinfo-stopped.xml");
    await expect
      .poll(
        async () =>
          (await mockHost.outbound()).filter((f) => f.event === "setTitle" && f.context === ctx1).pop()?.payload?.title,
        { timeout: 8000 },
      )
      .toBe("Stopped");
    await expect
      .poll(() => mock.calls.filter((c) => c.action === "GetTransportInfo").length, { timeout: 8000 })
      .toBeGreaterThan(2);
    const stoppedFrames = await mockHost.outbound();
    const stoppedSetTitle = stoppedFrames.filter((f) => f.event === "setTitle" && f.context === ctx1).pop();
    expect(stoppedSetTitle.payload.title).toBe("Stopped");
    const stoppedState = stoppedFrames.filter((f) => f.event === "setState" && f.context === ctx1).pop();
    expect(stoppedState.payload.state).toBe(2);

    // Phase D: Press on STOPPED → Play
    await mockHost.inject.keyDown(ctx1);
    await expect.poll(() => mock.calls.filter((c) => c.action === "Play").length, { timeout: 8000 }).toBeGreaterThan(0);
    const playCall = mock.calls.find((c) => c.action === "Play");
    expect(playCall.action).toBe("Play");

    // Phase E: Render all three states in preview
    await page.goto("/harness/key-preview.html");

    // Playing
    await page.evaluate((f) => window.renderFrames(f), playingFrames);
    await page.screenshot({ path: "tests/playwright/screenshots/p5-pp-playing.png", fullPage: true });
    await page.evaluate(() => window.resetPreview());

    // Paused
    await page.evaluate((f) => window.renderFrames(f), pausedFrames);
    await page.screenshot({ path: "tests/playwright/screenshots/p5-pp-paused.png", fullPage: true });
    await page.evaluate(() => window.resetPreview());

    // Stopped
    await page.evaluate((f) => window.renderFrames(f), stoppedFrames);
    await page.screenshot({ path: "tests/playwright/screenshots/p5-pp-stopped.png", fullPage: true });

    expect(consoleErrors.filter((e) => !e.includes("net::ERR"))).toEqual([]);
  });

  test("p5-play-mode-cycle", async ({ page }) => {
    const { mock, mockHost, consoleErrors } = await commonSetup(page, {
      actionFixtures: {
        ...GETTER_FIXTURES,
        GetTransportSettings: "gettransportsettings-repeatall.xml",
      },
    });

    const ctx1 = "ctx1";
    const settings = {
      uuid: "RINCON_OFFICE01400",
      hostAddress: "192.168.1.42",
      zoneName: "Office",
      displayStateBasedTitle: true,
      selectedPlayModes: ["NORMAL", "SHUFFLE"],
    };

    await mockHost.inject.willAppear(ctx1, "com.r-teller.sonoscontroller.toggle-play-mode", settings);
    await expect
      .poll(() => mock.calls.filter((c) => c.action === "GetTransportSettings").length, { timeout: 8000 })
      .toBeGreaterThan(0);

    // Press key
    await mockHost.inject.keyDown(ctx1);

    // Expect SetPlayMode call with NORMAL (fallback to first)
    await expect.poll(() => mock.calls.filter((c) => c.action === "SetPlayMode").length, { timeout: 8000 }).toBeGreaterThan(0);
    const setPlayModeCall = mock.calls.find((c) => c.action === "SetPlayMode");
    expect(setPlayModeCall.body).toContain("<NewPlayMode>NORMAL</NewPlayMode>");

    expect(consoleErrors.filter((e) => !e.includes("net::ERR"))).toEqual([]);
  });

  test("p5-input-source-coordinator", async ({ page }) => {
    const { mock, mockHost, consoleErrors } = await commonSetup(page, {
      topologyFixture: "zonegroupstate-multi-group.xml",
      actionFixtures: GETTER_FIXTURES,
    });

    const ctx1 = "ctx1";
    const settings = {
      uuid: "RINCON_DININGROOM01400",
      hostAddress: "192.168.1.44",
      zoneName: "Dining Room",
      displayStateBasedTitle: true,
    };

    await mockHost.inject.willAppear(ctx1, "com.r-teller.sonoscontroller.toggle-input-source", settings);
    await expect
      .poll(() => mock.calls.filter((c) => c.action === "GetTransportInfo").length, { timeout: 8000 })
      .toBeGreaterThan(0);

    // Press key
    await mockHost.inject.keyDown(ctx1);

    // Expect SetAVTransportURI call to coordinator (192.168.1.43)
    await expect
      .poll(() => mock.calls.filter((c) => c.action === "SetAVTransportURI").length, { timeout: 8000 })
      .toBeGreaterThan(0);
    const setAvTransportCall = mock.calls.find((c) => c.action === "SetAVTransportURI");
    expect(setAvTransportCall.host).toBe("192.168.1.43");
    expect(setAvTransportCall.body).toContain("x-sonos-htastream:RINCON_KITCHEN01400:spdif");

    // Expect Play call to coordinator
    await expect.poll(() => mock.calls.filter((c) => c.action === "Play").length, { timeout: 8000 }).toBeGreaterThan(0);
    const playCall = mock.calls.find((c) => c.action === "Play");
    expect(playCall.host).toBe("192.168.1.43");

    expect(consoleErrors.filter((e) => !e.includes("net::ERR"))).toEqual([]);
  });
  test("p5-volume-increment", async ({ page }) => {
    const { mock, mockHost, consoleErrors } = await commonSetup(page, {
      actionFixtures: { ...GETTER_FIXTURES },
    });

    const standard = {
      uuid: "RINCON_OFFICE01400",
      hostAddress: "192.168.1.42",
      zoneName: "Office",
      displayStateBasedTitle: true,
    };

    await mockHost.inject.globalSettings({ adjustVolumeIncrement: 10 });

    const ctx1 = "ctx1";
    await mockHost.inject.willAppear(ctx1, "volume-up", {
      ...standard,
      adjustVolumeIncrement: 1,
    });

    // Wait for initial GetVolume call
    await expect.poll(() => mock.calls.filter((c) => c.action === "GetVolume").length, { timeout: 8000 }).toBeGreaterThan(0);

    // First press
    await mockHost.inject.keyDown(ctx1);
    await expect.poll(() => mock.calls.filter((c) => c.action === "SetVolume").length, { timeout: 8000 }).toBeGreaterThan(0);

    const firstSetVolume = mock.calls.filter((c) => c.action === "SetVolume")[0];
    expect(firstSetVolume.host).toBe("192.168.1.42");
    expect(firstSetVolume.body).toContain("<DesiredVolume>43</DesiredVolume>");

    await page.waitForTimeout(150);

    // Second press
    await mockHost.inject.keyDown(ctx1);
    await expect.poll(() => mock.calls.filter((c) => c.action === "SetVolume").length, { timeout: 8000 }).toBeGreaterThan(1);

    const secondSetVolume = mock.calls.filter((c) => c.action === "SetVolume")[1];
    expect(secondSetVolume.body).toContain("<DesiredVolume>44</DesiredVolume>");

    // Wait for setTitle frame with "Vol 44"
    await expect
      .poll(
        async () => {
          const frames = await mockHost.outbound();
          return frames.find((f) => f.event === "setTitle" && f.context === ctx1 && f.payload.title === "Vol 44");
        },
        { timeout: 8000 },
      )
      .toBeDefined();

    expect(consoleErrors.filter((e) => !e.includes("net::ERR"))).toEqual([]);
  });

  test("p5-favorite-radio-vs-queue", async ({ page }) => {
    const { mock, mockHost, consoleErrors } = await commonSetup(page, {
      actionFixtures: { ...GETTER_FIXTURES },
    });

    const standard = {
      uuid: "RINCON_OFFICE01400",
      hostAddress: "192.168.1.42",
      zoneName: "Office",
      displayStateBasedTitle: true,
    };

    const RADIO_FAV = {
      title: "BBC Radio 1",
      uri: "x-sonosapi-stream:s24939?sid=254",
      albumArtURI: "/getaa?u=stream01",
      metadata:
        '<DIDL-Lite><item id="01"><dc:title>BBC Radio 1</dc:title><upnp:class>object.item.audioItem.audioBroadcast</upnp:class></item></DIDL-Lite>',
    };

    const CONTAINER_FAV = {
      title: "My Spotify Playlist",
      uri: "x-rincon-cpcontainer:1006206cspotify%3aplaylist%3a4u1aR",
      albumArtURI: "/getaa?u=spot02",
      metadata:
        '<DIDL-Lite><item id="02"><dc:title>My Spotify Playlist</dc:title><upnp:class>object.container.playlistContainer</upnp:class></item></DIDL-Lite>',
    };

    const ctx1 = "ctx1";
    await mockHost.inject.willAppear(ctx1, "play-sonos-favorite", {
      ...standard,
      selectedSonosFavorite: RADIO_FAV,
    });

    // Wait for initial poll (GetTransportInfo ≥ 1)
    await expect
      .poll(() => mock.calls.filter((c) => c.action === "GetTransportInfo").length, { timeout: 8000 })
      .toBeGreaterThanOrEqual(1);

    mock.clearCalls();

    // Press to play radio favorite
    await mockHost.inject.keyDown(ctx1);
    await expect.poll(() => mock.calls.filter((c) => c.action === "Play").length, { timeout: 8000 }).toBeGreaterThan(0);

    const av = mock.calls.filter((c) => c.service === "avTransport");
    expect(av.length).toBe(2);
    expect(av[0].action).toBe("SetAVTransportURI");
    expect(av[1].action).toBe("Play");

    // Verify single-escaped metadata (no double escape)
    expect(av[0].body).toContain("&lt;DIDL-Lite&gt;");
    expect(av[0].body).not.toContain("&amp;lt;");

    // Switch to container favorite
    mockHost.inject.didReceiveSettings(ctx1, {
      ...standard,
      selectedSonosFavorite: CONTAINER_FAV,
    });
    await page.waitForTimeout(150);
    mock.clearCalls();

    // Press to play container favorite
    await mockHost.inject.keyDown(ctx1);
    await expect.poll(() => mock.calls.filter((c) => c.action === "Play").length, { timeout: 8000 }).toBeGreaterThan(0);

    const av2 = mock.calls.filter((c) => c.service === "avTransport");
    expect(av2.map((c) => c.action)).toEqual([
      "RemoveAllTracksFromQueue",
      "AddURIToQueue",
      "SetAVTransportURI",
      "Seek",
      "Play",
    ]);

    // Verify container-specific assertions
    const addUriCall = av2.find((c) => c.action === "AddURIToQueue");
    expect(addUriCall.body).toContain("&lt;DIDL-Lite&gt;");
    expect(addUriCall.body).not.toContain("&amp;lt;");

    const setAvCall = av2.find((c) => c.action === "SetAVTransportURI");
    expect(setAvCall.body).toContain("x-rincon-queue:RINCON_OFFICE01400#0");

    const seekCall = av2.find((c) => c.action === "Seek");
    expect(seekCall.body).toContain("<Unit>TRACK_NR</Unit>");
    expect(seekCall.body).toContain("<Target>1</Target>");

    expect(consoleErrors.filter((e) => !e.includes("net::ERR"))).toEqual([]);
  });

  test("p5-eq-dial", async ({ page }) => {
    const { mock, mockHost, consoleErrors } = await commonSetup(page, {
      actionFixtures: { ...GETTER_FIXTURES },
    });

    const standard = {
      uuid: "RINCON_OFFICE01400",
      hostAddress: "192.168.1.42",
      zoneName: "Office",
      displayStateBasedTitle: true,
    };

    const ctx1 = "ctx1";
    await mockHost.inject.willAppear(
      ctx1,
      "encoder-audio-equalizer",
      {
        ...standard,
      },
      "Encoder",
    );

    // Wait for initial feedback and layout
    await expect
      .poll(
        async () => {
          const frames = await mockHost.outbound();
          return frames.find((f) => f.event === "setFeedback" && f.payload.value === 42);
        },
        { timeout: 8000 },
      )
      .toBeDefined();

    await expect
      .poll(
        async () => {
          const frames = await mockHost.outbound();
          return frames.find((f) => f.event === "setFeedbackLayout" && f.payload.layout === "./layouts/encoder-bar-0-100.json");
        },
        { timeout: 8000 },
      )
      .toBeDefined();

    // Burst dialRotate
    await mockHost.inject.dialRotate(ctx1, 1);
    await mockHost.inject.dialRotate(ctx1, 1);
    await mockHost.inject.dialRotate(ctx1, 1);

    // Wait for SetVolume count === 1
    await expect.poll(() => mock.calls.filter((c) => c.action === "SetVolume").length, { timeout: 8000 }).toBe(1);
    await page.waitForTimeout(500);
    expect(mock.calls.filter((c) => c.action === "SetVolume").length).toBe(1);

    const setVolumeCall = mock.calls.filter((c) => c.action === "SetVolume")[0];
    expect(setVolumeCall.body).toContain("<DesiredVolume>45</DesiredVolume>");

    // Wait for feedback update
    await expect
      .poll(
        async () => {
          const frames = await mockHost.outbound();
          return frames.find((f) => f.event === "setFeedback" && f.payload.value === 45);
        },
        { timeout: 8000 },
      )
      .toBeDefined();

    const volumeFrames = await mockHost.outbound();

    // Switch target to BASS
    mockHost.inject.didReceiveSettings(ctx1, {
      ...standard,
      encoderAudioEqualizerTarget: "BASS",
    });
    await mockHost.inject.touchTap(ctx1);

    // Wait for GetBass calls (poll + 2 more)
    await expect
      .poll(() => mock.calls.filter((c) => c.action === "GetBass").length, { timeout: 8000 })
      .toBeGreaterThanOrEqual(2);

    // Wait for setFeedbackLayout with gbar layout
    await expect
      .poll(
        async () => {
          const frames = await mockHost.outbound();
          return frames.find(
            (f) => f.event === "setFeedbackLayout" && f.payload.layout === "./layouts/encoder-gbar-10-10.json",
          );
        },
        { timeout: 8000 },
      )
      .toBeDefined();

    // Assert gbar layout frame count === 1
    const allFrames = await mockHost.outbound();
    const gbarLayoutFrames = allFrames.filter(
      (f) => f.event === "setFeedbackLayout" && f.payload.layout === "./layouts/encoder-gbar-10-10.json",
    );
    expect(gbarLayoutFrames.length).toBe(1);

    // Assert feedback frame for BASS
    await expect
      .poll(
        async () => {
          const frames = await mockHost.outbound();
          return frames.find(
            (f) =>
              f.event === "setFeedback" && f.payload.title === "Bass" && f.payload.value === -3 && f.payload.indicator === 7,
          );
        },
        { timeout: 8000 },
      )
      .toBeDefined();

    const bassFrames = await mockHost.outbound();

    // Preview
    await page.goto("/harness/key-preview.html");
    await page.evaluate(
      (f) => window.renderFrames(f, { actionIcons: { ctx1: "images/actions/equalizer@2x.png" } }),
      volumeFrames,
    );
    await page.screenshot({ path: "tests/playwright/screenshots/p5-eq-volume.png", fullPage: true });
    await page.evaluate(() => window.resetPreview());
    await page.evaluate(
      (f) => window.renderFrames(f, { actionIcons: { ctx1: "images/actions/equalizer@2x.png" } }),
      bassFrames,
    );
    await page.screenshot({ path: "tests/playwright/screenshots/p5-eq-bass.png", fullPage: true });
    await page.evaluate(() => window.resetPreview());

    expect(consoleErrors.filter((e) => !e.includes("net::ERR"))).toEqual([]);
  });

  test("p5-eq-dial-push", async ({ page }) => {
    // Pushing the Audio Equalizer dial runs its configured push action (sonos-6sp, sonos-8px.1).
    const { mock, mockHost, consoleErrors } = await commonSetup(page, {
      actionFixtures: { ...GETTER_FIXTURES },
    });
    const ctx = "ctx-eq-push";
    const settings = {
      uuid: "RINCON_OFFICE01400",
      hostAddress: "192.168.1.42",
      zoneName: "Office",
      encoderAudioEqualizerTarget: "VOLUME",
      encoderPushAction: "TOGGLE_MUTE",
    };
    const lastTitle = async () =>
      (await mockHost.outbound("setFeedback")).filter((f) => f.context === ctx && f.payload.title !== undefined).at(-1)?.payload
        .title;
    const setMutes = () => mock.calls.filter((c) => c.action === "SetMute");
    const afterNextPoll = (n) => waitForPollAfter(page, mock, { set: "SetMute", get: "GetMute", n });

    await mockHost.inject.willAppear(ctx, "encoder-audio-equalizer", settings, "Encoder");
    await expect.poll(lastTitle, { timeout: 8000 }).toBe("Volume");

    // Push: mute. dialDown + dialUp arrive, exactly one SetMute is sent.
    await mockHost.inject.dialDown(ctx);
    await expect.poll(() => setMutes().length, { timeout: 8000 }).toBe(1);
    expect(setMutes()[0].body).toContain("<DesiredMute>1</DesiredMute>");
    await expect.poll(lastTitle, { timeout: 8000 }).toBe("Muted");
    // Sticks after the next poll (stateful mock speaker, sonos-8px.2).
    await afterNextPoll(1);
    expect(await lastTitle()).toBe("Muted");
    expect(setMutes()).toHaveLength(1);

    // Push again: unmute.
    await mockHost.inject.dialDown(ctx);
    await expect.poll(() => setMutes().length, { timeout: 8000 }).toBe(2);
    expect(setMutes()[1].body).toContain("<DesiredMute>0</DesiredMute>");
    await afterNextPoll(2);
    expect(await lastTitle()).toBe("Volume");

    // No push action configured: a push sends nothing to the speaker.
    await mockHost.inject.didReceiveSettings(ctx, { ...settings, encoderPushAction: "NONE" });
    const before = mock.calls.filter((c) => /^(Set|Play|Pause|Next)/.test(c.action)).length;
    await mockHost.inject.dialDown(ctx);
    await page.waitForTimeout(800);
    expect(mock.calls.filter((c) => /^(Set|Play|Pause|Next)/.test(c.action)).length).toBe(before);

    expect(consoleErrors.filter((e) => !e.includes("net::ERR"))).toEqual([]);
  });

  test("p5-currently-playing-marquee", async ({ page }) => {
    test.setTimeout(90000);

    const { mock, mockHost, consoleErrors } = await commonSetup(page, {
      actionFixtures: {
        ...GETTER_FIXTURES,
        GetPositionInfo: "getpositioninfo-long-title.xml",
      },
    });

    const PNG_1x1 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    await page.route("**/getaa*", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG_1x1 }));

    const standard = {
      uuid: "RINCON_OFFICE01400",
      hostAddress: "192.168.1.42",
      zoneName: "Office",
      displayStateBasedTitle: true,
    };

    await mockHost.inject.globalSettings({ deviceCheckInterval: 1 });

    const ctx1 = "ctx1";
    await mockHost.inject.willAppear(ctx1, "currently-playing", {
      ...standard,
      displayMarqueeTitle: true,
      displayAlbumArt: true,
    });

    // Wait for GetPositionInfo calls ≥ 18
    await expect
      .poll(() => mock.calls.filter((c) => c.action === "GetPositionInfo").length, { timeout: 40000 })
      .toBeGreaterThanOrEqual(18);

    const frames = await mockHost.outbound();

    // Marquee assertion
    const TITLE = "Did You Know That There Is A Tunnel Under Ocean Blvd";
    const WRAP = TITLE.length + 4;
    const WIDTH = 8; // MARQUEE_WIDTH: what fits across a key (sonos-06p)
    const looped = TITLE + "    " + TITLE.slice(0, WIDTH);
    const w = (p) => looped.slice(p % WRAP, (p % WRAP) + WIDTH);

    const titles = frames
      .filter(
        (f) =>
          f.event === "setTitle" &&
          f.context === ctx1 &&
          typeof f.payload.title === "string" &&
          f.payload.title.length === WIDTH,
      )
      .map((f) => f.payload.title);

    const titles15 = titles.slice(-15);
    let p0 = -1;
    for (let i = 0; i < WRAP; i++) {
      if (w(i) === titles15[0]) {
        p0 = i;
        break;
      }
    }
    expect(p0).toBeGreaterThanOrEqual(0);

    for (let k = 1; k <= 14; k++) {
      expect(titles15[k]).toBe(w(p0 + k));
    }

    // Art assertion
    const setImageFrames = frames.filter(
      (f) =>
        f.event === "setImage" &&
        f.context === ctx1 &&
        typeof f.payload.image === "string" &&
        f.payload.image.startsWith("data:image/png"),
    );
    expect(setImageFrames.length).toBeGreaterThan(0);

    const marqueeFrames = frames;

    // TV phase
    mock.setActionFixture("GetPositionInfo", "getpositioninfo-tv.xml");
    await mockHost.clearOutbound();

    // Wait for TV frames
    await expect
      .poll(
        async () => {
          const frames = await mockHost.outbound();
          return frames.find(
            (f) => f.event === "setImage" && f.context === ctx1 && f.payload.image === "./images/keys/input_tv.png",
          );
        },
        { timeout: 8000 },
      )
      .toBeDefined();

    await expect
      .poll(
        async () => {
          const frames = await mockHost.outbound();
          return frames.find((f) => f.event === "setTitle" && f.context === ctx1 && f.payload.title === "TV");
        },
        { timeout: 8000 },
      )
      .toBeDefined();

    const tvFrames = await mockHost.outbound();

    // Preview
    await page.goto("/harness/key-preview.html");
    await page.evaluate((f) => window.renderFrames(f), marqueeFrames);
    await page.screenshot({ path: "tests/playwright/screenshots/p5-nowplaying.png", fullPage: true });
    await page.evaluate(() => window.resetPreview());
    await page.evaluate((f) => window.renderFrames(f), tvFrames);
    await page.screenshot({ path: "tests/playwright/screenshots/p5-nowplaying-tv.png", fullPage: true });
    await page.evaluate(() => window.resetPreview());

    // DEFERRED-ICONS baseline: the built bundle ships no images/ yet, so the
    // preview page 404s on "./images/keys/input_tv.png". The frame-level
    // assertion above is the acceptance; filter the resource-load noise.
    expect(consoleErrors.filter((e) => !e.includes("net::ERR") && !e.includes("Failed to load resource"))).toEqual([]);
  });

  test("p5-error-alert", async ({ page }) => {
    const { mock, mockHost, consoleErrors } = await commonSetup(page, {
      actionFixtures: { ...GETTER_FIXTURES },
    });

    const standard = {
      uuid: "RINCON_OFFICE01400",
      hostAddress: "192.168.1.42",
      zoneName: "Office",
      displayStateBasedTitle: true,
    };

    const ctx1 = "ctx1";
    const ctx2 = "ctx2";
    await mockHost.inject.willAppear(ctx1, "toggle-mute-unmute", standard);
    await mockHost.inject.willAppear(ctx2, "toggle-mute-unmute", standard);

    // Wait for initial poll + setTitle
    await expect.poll(() => mock.calls.filter((c) => c.action === "GetMute").length, { timeout: 8000 }).toBeGreaterThan(0);
    await expect
      .poll(
        async () => {
          const frames = await mockHost.outbound();
          return frames.filter((f) => f.event === "setTitle" && [ctx1, ctx2].includes(f.context));
        },
        { timeout: 8000 },
      )
      .toHaveLength(2);

    // Set failure mode
    mock.setFailure("rendering", { mode: "abort" });

    // Press
    await mockHost.inject.keyDown(ctx1);

    // Wait for showAlert frames
    await expect
      .poll(
        async () => {
          const frames = await mockHost.outbound();
          const showAlerts = frames.filter((f) => f.event === "showAlert");
          return showAlerts.find((f) => f.context === ctx1) && showAlerts.find((f) => f.context === ctx2);
        },
        { timeout: 8000 },
      )
      .toBeDefined();

    const frames = await mockHost.outbound();

    // Preview
    await page.goto("/harness/key-preview.html");
    await page.evaluate((f) => window.renderFrames(f), frames);

    // Assert alert markers
    const alert1 = await page.evaluate(() => {
      const el = window.getTile("ctx1").el.querySelector(".tile-alert");
      return window.getComputedStyle(el).display;
    });
    const alert2 = await page.evaluate(() => {
      const el = window.getTile("ctx2").el.querySelector(".tile-alert");
      return window.getComputedStyle(el).display;
    });
    expect(alert1).toBe("flex");
    expect(alert2).toBe("flex");

    await page.screenshot({ path: "tests/playwright/screenshots/p5-error-alert.png", fullPage: true });
    await page.evaluate(() => window.resetPreview());

    expect(consoleErrors.filter((e) => !e.includes("net::ERR"))).toEqual([]);
  });
});
