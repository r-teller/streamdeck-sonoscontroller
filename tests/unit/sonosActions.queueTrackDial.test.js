// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let controller;
vi.mock("@/modules/actions/helpers.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, makeController: vi.fn(() => controller), raceWithTimeout: (p) => p };
});

import { actionFunctionMap, _resetActionFunctionMap } from "@/modules/plugin/actionDispatcher.js";
import { registerSonosActions, queueView, QUEUE_DIAL_SETTLE_MS } from "@/modules/actions/sonosActions.js";
import { _resetCarousels, _setCanvasFactory, browseTick, CAROUSEL_LAYOUT } from "@/modules/plugin/carousel.js";
import { _resetQueueCache, _pendingLoad, queueItems, setQueueLoadedHook, MAX_ITEMS } from "@/modules/plugin/queueCache.js";
import { PLAY_MODE_DIAL_SETTLE_MS } from "@/modules/actions/sonosActions.js";

const dial = () => actionFunctionMap["encoder-queue-track"];
const UUID = "RINCON_X";
const settings = { hostAddress: "h", uuid: UUID };
const QUEUE = "x-rincon-queue:RINCON_X#0";
const sig = (total, updateId = "1") => ({ updateId, total, firstTrackUri: "u1" });
const items = (n) =>
  Array.from({ length: n }, (_, i) => ({
    title: `Song ${i + 1}`,
    artist: `Artist ${i + 1}`,
    album: "Album",
    uri: `u${i + 1}`,
    albumArtURI: "",
  }));
const onQueue = (total, track = 1, extra = {}) => ({
  mediaURI: QUEUE,
  queueSignature: sig(total),
  trackNumber: track,
  ...extra,
});

beforeEach(() => {
  _resetActionFunctionMap();
  registerSonosActions();
  _resetCarousels();
  _resetQueueCache();
  _setCanvasFactory(() => null);
  controller = {
    seek: vi.fn().mockResolvedValue(undefined),
    play: vi.fn().mockResolvedValue(undefined),
    getQueue: vi.fn(async ({ startIndex, requestedCount }) => ({
      list: items(5).slice(startIndex, startIndex + requestedCount),
    })),
  };
});

afterEach(() => {
  _resetCarousels();
  setQueueLoadedHook(null);
});

describe("encoder-queue-track registration", () => {
  it("is a carousel dial that waits longer before playing than the mode dial", () => {
    expect(dial().carousel).toBe(true);
    expect(dial().dialSettleMs).toBe(QUEUE_DIAL_SETTLE_MS);
    expect(QUEUE_DIAL_SETTLE_MS).toBeGreaterThan(PLAY_MODE_DIAL_SETTLE_MS);
    expect(dial().dialRotate).toHaveLength(1);
    expect(dial().dialDown).toHaveLength(1);
    expect(dial().touchTap).toHaveLength(1);
  });
});

describe("queueView", () => {
  it("reads queue playback, size and current track", () => {
    expect(queueView(onQueue(5, 3))).toMatchObject({ known: true, onQueue: true, total: 5, base: 2 });
  });
  it("not on the queue: radio / TV / line-in", () => {
    expect(queueView({ mediaURI: "x-sonosapi-stream:s1", queueSignature: null })).toMatchObject({
      known: true,
      onQueue: false,
      total: 0,
    });
  });
  it("unknown before the first poll", () => {
    expect(queueView({}).known).toBe(false);
  });
});

describe("encoder-queue-track dialRotate (turning stopped)", () => {
  const rotate = (state, inRotation) =>
    dial().dialRotate[0]({ inContext: "c", inActionSettings: settings, inSonosSpeakerState: state, inRotation });

  it("+1 plays the next track: one seek by track number, then play", async () => {
    const r = await rotate(onQueue(5, 2), 1);
    expect(controller.seek).toHaveBeenCalledWith("TRACK_NR", "3");
    expect(controller.play).toHaveBeenCalledTimes(1);
    expect(r.status).toBe("SUCCESS");
    expect(r.updatedSonosSpeakerState).toMatchObject({ trackNumber: 3, playbackState: "PLAYING" });
  });

  it("-1 and a burst use the net steps", async () => {
    await rotate(onQueue(5, 4), -1);
    expect(controller.seek).toHaveBeenLastCalledWith("TRACK_NR", "3");
    await rotate(onQueue(5, 1), 3);
    expect(controller.seek).toHaveBeenLastCalledWith("TRACK_NR", "4");
    expect(controller.seek).toHaveBeenCalledTimes(2);
  });

  it("wraps past both ends", async () => {
    await rotate(onQueue(5, 5), 1);
    expect(controller.seek).toHaveBeenLastCalledWith("TRACK_NR", "1");
    await rotate(onQueue(5, 1), -1);
    expect(controller.seek).toHaveBeenLastCalledWith("TRACK_NR", "5");
  });

  it("net zero or a full lap sends nothing", async () => {
    expect(await rotate(onQueue(5, 2), 0)).toEqual({ status: "SUCCESS" });
    expect(await rotate(onQueue(5, 2), 5)).toEqual({ status: "SUCCESS" });
    expect(controller.seek).not.toHaveBeenCalled();
  });

  it("not playing from the queue or empty queue: nothing sent", async () => {
    expect(await rotate({ mediaURI: "x-sonosapi-stream:s1" }, 1)).toEqual({ status: "SUCCESS" });
    expect(await rotate(onQueue(0, 0), 1)).toEqual({ status: "SUCCESS" });
    expect(controller.seek).not.toHaveBeenCalled();
  });

  it("projects the chosen track's title and art when the queue is loaded", async () => {
    queueItems(UUID, sig(5), () => controller);
    await _pendingLoad(UUID);
    const r = await rotate(onQueue(5, 1), 2);
    expect(r.updatedSonosSpeakerState.playing).toMatchObject({ title: "Song 3", artist: "Artist 3" });
  });

  it("speaker error -> ERROR", async () => {
    controller.seek.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await rotate(onQueue(5, 1), 1)).toEqual({ status: "ERROR" });
  });
});

describe("encoder-queue-track push and tap: next track now", () => {
  for (const event of ["dialDown", "touchTap"]) {
    it(`${event} plays the next track, wrapping last -> first`, async () => {
      const call = (state) => dial()[event][0]({ inContext: "c", inActionSettings: settings, inSonosSpeakerState: state });
      await call(onQueue(5, 2));
      expect(controller.seek).toHaveBeenLastCalledWith("TRACK_NR", "3");
      await call(onQueue(5, 5));
      expect(controller.seek).toHaveBeenLastCalledWith("TRACK_NR", "1");
      expect(controller.play).toHaveBeenCalledTimes(2);
    });

    it(`${event} does nothing when not playing from the queue`, async () => {
      const r = await dial()[event][0]({
        inContext: "c",
        inActionSettings: settings,
        inSonosSpeakerState: { mediaURI: "x-rincon-stream:RINCON_X" },
      });
      expect(r).toEqual({ status: "SUCCESS" });
      expect(controller.seek).not.toHaveBeenCalled();
    });
  }
});

describe("encoder-queue-track state", () => {
  const render = (state) =>
    dial().state.encoder({ inContext: "c", inActionSettings: settings, inSonosSpeakerState: state }).feedback;

  it("message cards: loading, not on queue, empty", () => {
    expect(render({}).caption).toBe("Loading queue…");
    expect(render({ mediaURI: "x-sonosapi-stream:s1" }).caption).toBe("Not playing from queue");
    expect(render(onQueue(0, 0)).caption).toBe("Queue is empty");
    expect(render({ mediaURI: "x-sonosapi-stream:s1" }).cards).toBe("");
  });

  it("carousel centred on the playing track once the queue is loaded", async () => {
    const intent = dial().state.encoder({ inContext: "c", inActionSettings: settings, inSonosSpeakerState: onQueue(5, 3) });
    expect(intent.feedbackLayout).toBe(CAROUSEL_LAYOUT);
    expect(intent.feedback.caption).toBe("Track 3"); // not loaded yet
    await _pendingLoad(UUID);
    expect(render(onQueue(5, 3))).toMatchObject({ caption: "Song 3", detail: "Artist 3 · 3 / 5" });
  });

  it("while browsing, shows the turned-to track before anything is played", async () => {
    render(onQueue(5, 5));
    await _pendingLoad(UUID);
    browseTick("c", 1);
    expect(render(onQueue(5, 5)).caption).toBe("Song 1"); // wrapped
    expect(controller.seek).not.toHaveBeenCalled();
  });
});

describe("queue cache", () => {
  it("loads once per signature and reloads when the queue changes", async () => {
    const loaded = [];
    setQueueLoadedHook((uuid) => loaded.push(uuid));
    queueItems(UUID, sig(5, "1"), () => controller);
    queueItems(UUID, sig(5, "1"), () => controller);
    await _pendingLoad(UUID);
    expect(controller.getQueue).toHaveBeenCalledTimes(1);
    expect(queueItems(UUID, sig(5, "1"), () => controller)).toHaveLength(5);
    queueItems(UUID, sig(5, "2"), () => controller);
    await _pendingLoad(UUID);
    expect(controller.getQueue).toHaveBeenCalledTimes(2);
    expect(loaded).toEqual([UUID, UUID]);
  });

  it("fetches long queues in chunks, up to the limit", async () => {
    controller.getQueue = vi.fn(async ({ startIndex, requestedCount }) => ({
      list: Array.from({ length: requestedCount }, (_, i) => ({ title: `S${startIndex + i + 1}` })),
    }));
    queueItems(UUID, sig(1234), () => controller);
    await _pendingLoad(UUID);
    expect(controller.getQueue).toHaveBeenCalledTimes(MAX_ITEMS / 100);
    expect(queueItems(UUID, sig(1234), () => controller)).toHaveLength(MAX_ITEMS);
  });

  it("a failed fetch is retried on the next read", async () => {
    queueItems(UUID, sig(5, "1"), () => controller);
    await _pendingLoad(UUID);
    controller.getQueue.mockRejectedValueOnce(new Error("boom"));
    queueItems(UUID, sig(5, "2"), () => controller);
    await _pendingLoad(UUID);
    queueItems(UUID, sig(5, "2"), () => controller);
    await _pendingLoad(UUID);
    expect(controller.getQueue).toHaveBeenCalledTimes(3);
  });
});
