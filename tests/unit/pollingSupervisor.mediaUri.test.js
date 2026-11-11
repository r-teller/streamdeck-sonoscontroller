import { describe, it, expect } from "vitest";
import { PLAY_MODE_ACTION_NAMES, speakerHasPlayModeAction } from "@/modules/plugin/pollingSupervisor.js";

describe("media URI polling for play-mode actions (sonos-8cc)", () => {
  it("covers the Toggle Play Mode key and the Play Mode dial", () => {
    expect([...PLAY_MODE_ACTION_NAMES].sort()).toEqual(["encoder-play-mode", "toggle-play-mode"]);
  });
  it("is false for an unknown speaker", () => {
    expect(speakerHasPlayModeAction("NOPE")).toBe(false);
  });
});
