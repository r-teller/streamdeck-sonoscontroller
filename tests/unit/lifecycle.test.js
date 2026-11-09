import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

import { wireLifecycleHandlers } from "@/modules/plugin/lifecycle.js";
import { getAllSpeakers, addContext, removeContext, moveContext } from "@/modules/plugin/SonosSpeakers.js";
import { actionSettings, getActionSettings, setActionSettings, deleteActionSettings } from "@/modules/plugin/actionSettings.js";
import { globalSettings, setGlobalSettings } from "@/modules/plugin/globalSettings.js";

import * as dialDebouncer from "@/modules/plugin/dialRotateDebouncer.js";

const createSd = () => {
  const sd = new EventEmitter();
  sd.showAlert = vi.fn();
  return sd;
};

beforeEach(() => {
  // reset singleton state
  const all = getAllSpeakers();
  for (const k of Object.keys(all)) delete all[k];
  for (const k of Object.keys(actionSettings)) delete actionSettings[k];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("wireLifecycleHandlers", () => {
  test("falsy sd returns no‑op and wires nothing", () => {
    const deps = {
      callAction: vi.fn(),
      handleDialRotate: vi.fn(),
      clearDedupeCache: vi.fn(),
    };
    const teardown = wireLifecycleHandlers({ sd: null }, deps);
    expect(typeof teardown).toBe("function");
    expect(() => teardown()).not.toThrow();
  });

  test("willAppear stores settings and creates speaker when uuid present", () => {
    const sd = createSd();
    const deps = {
      callAction: vi.fn(),
      handleDialRotate: vi.fn(),
      clearDedupeCache: vi.fn(),
    };
    const teardown = wireLifecycleHandlers({ sd }, deps);
    sd.emit("willAppear", {
      action: "com.x.toggle-mute-unmute",
      context: "c1",
      payload: {
        state: 2,
        controller: "Keypad",
        settings: {
          uuid: "uA",
          hostAddress: "h1",
          zoneName: "Z",
        },
      },
    });

    const settings = getActionSettings("c1");
    expect(settings).toMatchObject({
      action: "com.x.toggle-mute-unmute",
      controller: "Keypad",
      currentStateIndex: 2,
      uuid: "uA",
      hostAddress: "h1",
      zoneName: "Z",
      status: {},
    });

    const speakers = getAllSpeakers();
    expect(speakers["uA"]).toBeTruthy();
    // speaker should contain the context; exact shape is not defined, just ensure it references it
    expect(speakers["uA"].contexts).toContain("c1");
    expect(speakers["uA"].hostAddress).toBe("h1");
    expect(speakers["uA"].zoneName).toBe("Z");

    teardown();
  });

  test("willAppear without state defaults to 0 and without uuid creates no speaker", () => {
    const sd = createSd();
    const deps = {
      callAction: vi.fn(),
      handleDialRotate: vi.fn(),
      clearDedupeCache: vi.fn(),
    };
    const teardown = wireLifecycleHandlers({ sd }, deps);
    sd.emit("willAppear", {
      action: "com.x.toggle-mute-unmute",
      context: "c2",
      payload: {
        // no state, no uuid
        controller: "Keypad",
        settings: {
          hostAddress: "h2",
          zoneName: "Z2",
        },
      },
    });

    const settings = getActionSettings("c2");
    expect(settings.currentStateIndex).toBe(0);
    expect(settings.uuid).toBeUndefined();

    const speakers = getAllSpeakers();
    expect(speakers["undefined"]).toBeUndefined();

    teardown();
  });

  test("willDisappear removes speaker, clears dial state and deletes settings", () => {
    const sd = createSd();
    const deps = {
      callAction: vi.fn(),
      handleDialRotate: vi.fn(),
      clearDedupeCache: vi.fn(),
    };
    const cleanupSpy = vi.spyOn(dialDebouncer, "cleanupDialRotate");
    const teardown = wireLifecycleHandlers({ sd }, deps);

    // first appear to create speaker
    sd.emit("willAppear", {
      action: "com.x.toggle-mute-unmute",
      context: "c3",
      payload: {
        settings: { uuid: "uB", hostAddress: "h3", zoneName: "Z3" },
      },
    });
    expect(getAllSpeakers()["uB"]).toBeTruthy();

    // now disappear
    sd.emit("willDisappear", { context: "c3" });

    expect(getAllSpeakers()["uB"]).toBeUndefined();
    expect(getActionSettings("c3")).toBeUndefined();
    expect(cleanupSpy).toHaveBeenCalledOnce();
    expect(cleanupSpy).toHaveBeenCalledWith("c3");

    teardown();
  });

  test("didReceiveSettings merges without uuid change, retains status, no dedupe clear", () => {
    const sd = createSd();
    const deps = {
      callAction: vi.fn(),
      handleDialRotate: vi.fn(),
      clearDedupeCache: vi.fn(),
    };
    const clearSpy = vi.spyOn(deps, "clearDedupeCache");
    const teardown = wireLifecycleHandlers({ sd }, deps);

    // initial willAppear with uuid
    sd.emit("willAppear", {
      action: "com.x.toggle-mute-unmute",
      context: "c4",
      payload: {
        settings: { uuid: "uC", hostAddress: "h4", zoneName: "Z4" },
      },
    });
    // set a status field
    const as = getActionSettings("c4");
    as.status.lastTitleValue = "keep";

    // didReceiveSettings with same uuid and extra field
    sd.emit("didReceiveSettings", {
      context: "c4",
      payload: { settings: { uuid: "uC", extra: "new" } },
    });

    const merged = getActionSettings("c4");
    expect(merged.uuid).toBe("uC");
    expect(merged.extra).toBe("new");
    expect(merged.status.lastTitleValue).toBe("keep");
    expect(clearSpy).not.toHaveBeenCalled();

    teardown();
  });

  test("willAppear on an already-polled speaker draws the key immediately (sonos-ajj)", () => {
    const sd = createSd();
    const refreshStateAndTitle = vi.fn();
    const teardown = wireLifecycleHandlers({ sd }, { clearDedupeCache: vi.fn(), refreshStateAndTitle });
    addContext({ UUID: "uP", context: "existing", hostAddress: "h" });
    const speaker = getAllSpeakers()["uP"];
    speaker.state = { playbackState: "PLAYING" };
    speaker.lastChecked = 123;

    sd.emit("willAppear", {
      action: "com.x.toggle-play-pause",
      context: "new",
      payload: { settings: { uuid: "uP", hostAddress: "h", zoneName: "Z" } },
    });

    expect(refreshStateAndTitle).toHaveBeenCalledWith({
      inContext: "new",
      inSonosSpeakerState: speaker.state,
      force: true,
    });
    expect(speaker.lastChecked).toBe(123); // no extra poll needed
    teardown();
  });

  test("willAppear on a speaker with no state yet schedules an immediate poll instead", () => {
    const sd = createSd();
    const refreshStateAndTitle = vi.fn();
    const teardown = wireLifecycleHandlers({ sd }, { clearDedupeCache: vi.fn(), refreshStateAndTitle });
    addContext({ UUID: "uQ", context: "existing", hostAddress: "h" });
    getAllSpeakers()["uQ"].lastChecked = 999;

    sd.emit("willAppear", {
      action: "com.x.toggle-play-pause",
      context: "new",
      payload: { settings: { uuid: "uQ", hostAddress: "h", zoneName: "Z" } },
    });

    expect(refreshStateAndTitle).not.toHaveBeenCalled();
    expect(getAllSpeakers()["uQ"].lastChecked).toBe(0);
    teardown();
  });

  test("didReceiveSettings re-draws the key so PI changes apply at once (sonos-ajj)", () => {
    const sd = createSd();
    const refreshStateAndTitle = vi.fn();
    const teardown = wireLifecycleHandlers({ sd }, { clearDedupeCache: vi.fn(), refreshStateAndTitle });
    sd.emit("willAppear", {
      action: "com.x.encoder-audio-equalizer",
      context: "dial",
      payload: { controller: "Encoder", settings: { uuid: "uR", hostAddress: "h", zoneName: "Z" } },
    });
    getAllSpeakers()["uR"].state = { audioEqualizer: { volume: 20, bass: 1, treble: 0 } };
    refreshStateAndTitle.mockClear();

    sd.emit("didReceiveSettings", {
      context: "dial",
      payload: { settings: { uuid: "uR", encoderAudioEqualizerTarget: "BASS" } },
    });

    expect(refreshStateAndTitle).toHaveBeenCalledTimes(1);
    expect(refreshStateAndTitle.mock.calls[0][0]).toMatchObject({ inContext: "dial", force: true });
    expect(getActionSettings("dial").encoderAudioEqualizerTarget).toBe("BASS");
    teardown();
  });

  describe("stale PI snapshots cannot undo plugin-owned fields (sonos-uyz)", () => {
    afterEach(() => setGlobalSettings({}));

    test("an old uuid the plugin already repointed is kept on the new speaker and re-saved", () => {
      setGlobalSettings({
        devices: { NEW: { uuid: "NEW", zoneName: "Office", hostAddress: "h80", isSatellite: false } },
        speakerReplacements: { OLD: "NEW" },
      });
      const sd = createSd();
      sd.saveSettings = vi.fn();
      const teardown = wireLifecycleHandlers({ sd }, { clearDedupeCache: vi.fn(), refreshStateAndTitle: vi.fn() });
      sd.emit("willAppear", {
        action: "com.x.toggle-play-pause",
        context: "k",
        payload: { settings: { uuid: "NEW", hostAddress: "h80", zoneName: "Office", title: "Office (h80)" } },
      });
      sd.saveSettings.mockClear();

      // PI toggles a switch with its snapshot from before the repoint
      sd.emit("didReceiveSettings", {
        context: "k",
        payload: { settings: { uuid: "OLD", hostAddress: "h78", zoneName: "Office", displayAlbumArt: true } },
      });

      const now = getActionSettings("k");
      expect(now).toMatchObject({ uuid: "NEW", hostAddress: "h80", displayAlbumArt: true });
      expect(getAllSpeakers()["NEW"].contexts).toContain("k");
      expect(getAllSpeakers()["OLD"]).toBeUndefined();
      expect(sd.saveSettings).toHaveBeenCalledWith({
        context: "k",
        actionSettings: expect.objectContaining({ uuid: "NEW", displayAlbumArt: true }),
      });
      teardown();
    });

    test("a stale favorite signature is kept at the plugin's value; a new favorite drops it", () => {
      const sd = createSd();
      sd.saveSettings = vi.fn();
      const teardown = wireLifecycleHandlers({ sd }, { clearDedupeCache: vi.fn(), refreshStateAndTitle: vi.fn() });
      const fav = { title: "K", uri: "x-rincon-cpcontainer:k" };
      const sig = { speakerUuid: "S", updateId: "4", total: 100, firstTrackUri: "t1" };
      sd.emit("willAppear", {
        action: "com.r-teller.sonoscontroller.play-sonos-favorite",
        context: "f",
        payload: {
          settings: { uuid: "S", hostAddress: "h", zoneName: "Z", selectedSonosFavorite: fav, favoriteSignature: sig, displayFavoriteName: true },
        },
      });

      sd.emit("didReceiveSettings", {
        context: "f",
        payload: { settings: { uuid: "S", selectedSonosFavorite: fav, favoriteSignature: null, displayTrackTitle: true } },
      });
      expect(getActionSettings("f").favoriteSignature).toEqual(sig);
      expect(getActionSettings("f").displayTrackTitle).toBe(true);
      expect(sd.saveSettings).toHaveBeenCalledTimes(1);

      sd.emit("didReceiveSettings", {
        context: "f",
        payload: { settings: { uuid: "S", selectedSonosFavorite: { title: "T", uri: "x-rincon-cpcontainer:t" }, favoriteSignature: sig } },
      });
      expect(getActionSettings("f").favoriteSignature).toBeNull();
      teardown();
    });
  });

  test("didReceiveSettings with uuid change moves context and clears dedupe", () => {
    const sd = createSd();
    const deps = {
      callAction: vi.fn(),
      handleDialRotate: vi.fn(),
      clearDedupeCache: vi.fn(),
    };
    const clearSpy = vi.spyOn(deps, "clearDedupeCache");
    const moveSpy = vi.spyOn(dialDebouncer, "cleanupDialRotate"); // not needed but ensure no conflict
    const teardown = wireLifecycleHandlers({ sd }, deps);

    // initial appear with uuid uD
    sd.emit("willAppear", {
      action: "com.x.toggle-mute-unmute",
      context: "c5",
      payload: {
        settings: { uuid: "uD", hostAddress: "h5", zoneName: "Z5" },
      },
    });

    // didReceiveSettings with different uuid
    sd.emit("didReceiveSettings", {
      context: "c5",
      payload: { settings: { uuid: "uE", hostAddress: "h5b", zoneName: "Z5b" } },
    });

    // old speaker should be gone, new speaker present
    expect(getAllSpeakers()["uD"]).toBeUndefined();
    expect(getAllSpeakers()["uE"]).toBeTruthy();

    expect(clearSpy).toHaveBeenCalledOnce();
    expect(clearSpy).toHaveBeenCalledWith("c5");

    teardown();
  });

  test("didReceiveSettings first bind creates speaker without dedupe clear", () => {
    const sd = createSd();
    const deps = {
      callAction: vi.fn(),
      handleDialRotate: vi.fn(),
      clearDedupeCache: vi.fn(),
    };
    const clearSpy = vi.spyOn(deps, "clearDedupeCache");
    const teardown = wireLifecycleHandlers({ sd }, deps);

    // willAppear without uuid
    sd.emit("willAppear", {
      action: "com.x.toggle-mute-unmute",
      context: "c6",
      payload: { settings: { hostAddress: "h6", zoneName: "Z6" } },
    });
    expect(getAllSpeakers()["undefined"]).toBeUndefined();

    // didReceiveSettings with uuid now
    sd.emit("didReceiveSettings", {
      context: "c6",
      payload: { settings: { uuid: "uF", hostAddress: "h6", zoneName: "Z6" } },
    });

    expect(getAllSpeakers()["uF"]).toBeTruthy();
    expect(clearSpy).not.toHaveBeenCalled();

    teardown();
  });

  test("globalsettings updates globalSettings singleton", () => {
    const sd = createSd();
    const deps = {
      callAction: vi.fn(),
      handleDialRotate: vi.fn(),
      clearDedupeCache: vi.fn(),
    };
    const teardown = wireLifecycleHandlers({ sd }, deps);
    sd.emit("globalsettings", { deviceCheckInterval: 30 });
    expect(globalSettings.deviceCheckInterval).toBe(30);
    teardown();
  });

  test("systemDidWakeUp is wired but does nothing", () => {
    const sd = createSd();
    const deps = {
      callAction: vi.fn(),
      handleDialRotate: vi.fn(),
      clearDedupeCache: vi.fn(),
    };
    const teardown = wireLifecycleHandlers({ sd }, deps);
    expect(sd.listenerCount("systemDidWakeUp")).toBe(1);
    const beforeSpeakers = { ...getAllSpeakers() };
    const beforeSettings = { ...actionSettings };
    sd.emit("systemDidWakeUp");
    expect(getAllSpeakers()).toEqual(beforeSpeakers);
    expect(actionSettings).toEqual(beforeSettings);
    teardown();
  });

  test.each([
    ["keyDown", "keyDown"],
    ["dialDown", "dialDown"],
    ["touchTap", "touchTap"],
  ])("%s calls injected callAction with correct event", (eventName, expectedEvent) => {
    const sd = createSd();
    const callActionMock = vi.fn();
    const deps = {
      callAction: callActionMock,
      handleDialRotate: vi.fn(),
      clearDedupeCache: vi.fn(),
    };
    const teardown = wireLifecycleHandlers({ sd }, deps);
    sd.emit(eventName, { context: "c7" });
    expect(callActionMock).toHaveBeenCalledOnce();
    const firstArg = callActionMock.mock.calls[0][0];
    expect(firstArg).toMatchObject({
      inContext: "c7",
      inEvent: expectedEvent,
    });
    const secondArg = callActionMock.mock.calls[0][1];
    expect(secondArg).toMatchObject({
      actionSettings,
      showAlert: expect.any(Function),
    });
    teardown();
  });

  test("dialRotate forwards to injected handleDialRotate with correct args", () => {
    const sd = createSd();
    const handleDialRotateMock = vi.fn();
    const deps = {
      callAction: vi.fn(),
      handleDialRotate: handleDialRotateMock,
      clearDedupeCache: vi.fn(),
    };
    const teardown = wireLifecycleHandlers({ sd }, deps);
    sd.emit("dialRotate", { context: "c8", payload: { ticks: -3 } });
    expect(handleDialRotateMock).toHaveBeenCalledOnce();
    const call = handleDialRotateMock.mock.calls[0][0];
    expect(call).toMatchObject({
      context: "c8",
      ticks: -3,
      dispatch: expect.any(Function),
    });
    // missing ticks defaults to 0
    handleDialRotateMock.mockReset();
    sd.emit("dialRotate", { context: "c9", payload: {} });
    expect(handleDialRotateMock).toHaveBeenCalledOnce();
    expect(handleDialRotateMock.mock.calls[0][0].ticks).toBe(0);
    teardown();
  });

  test("keyUp and dialUp are not wired", () => {
    const sd = createSd();
    const deps = {
      callAction: vi.fn(),
      handleDialRotate: vi.fn(),
      clearDedupeCache: vi.fn(),
    };
    const teardown = wireLifecycleHandlers({ sd }, deps);
    expect(sd.listenerCount("keyUp")).toBe(0);
    expect(sd.listenerCount("dialUp")).toBe(0);
    teardown();
  });

  test("double wiring and double teardown leaves no listeners", () => {
    const sd = createSd();
    const deps = {
      callAction: vi.fn(),
      handleDialRotate: vi.fn(),
      clearDedupeCache: vi.fn(),
    };
    const teardown1 = wireLifecycleHandlers({ sd }, deps);
    const teardown2 = wireLifecycleHandlers({ sd }, deps);
    // each teardown called twice
    teardown1();
    teardown1();
    teardown2();
    teardown2();

    const events = [
      "willAppear",
      "willDisappear",
      "didReceiveSettings",
      "globalsettings",
      "systemDidWakeUp",
      "keyDown",
      "dialDown",
      "touchTap",
      "dialRotate",
    ];
    for (const ev of events) {
      expect(sd.listenerCount(ev)).toBe(0);
    }
  });
});
