// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { profilesFolderPath, copyText } from "@/modules/pi/profilesFolder.js";

describe("profilesFolderPath (sonos-sad)", () => {
  it("returns a Windows path with backslashes and decoded spaces", () => {
    const href =
      "file:///C:/Users/Rob%20T/AppData/Roaming/Elgato/StreamDeck/Plugins/com.r-teller.sonoscontroller.sdPlugin/pi.html";
    expect(profilesFolderPath(href)).toBe("C:\\Users\\Rob T\\AppData\\Roaming\\Elgato\\StreamDeck\\ProfilesV2");
  });

  it("returns a POSIX path on macOS", () => {
    const href =
      "file:///Users/rob/Library/Application%20Support/com.elgato.StreamDeck/Plugins/com.r-teller.sonoscontroller.sdPlugin/pi.html";
    expect(profilesFolderPath(href)).toBe("/Users/rob/Library/Application Support/com.elgato.StreamDeck/ProfilesV2");
  });

  it("returns null outside Stream Deck", () => {
    expect(profilesFolderPath("http://localhost:5173/pi.html")).toBeNull();
    expect(profilesFolderPath("not a url")).toBeNull();
  });
});

describe("copyText", () => {
  const original = navigator.clipboard;
  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: original, configurable: true });
    vi.restoreAllMocks();
  });

  it("uses the Clipboard API when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    expect(await copyText("C:\\x")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("C:\\x");
  });

  it("falls back to select + execCommand when the Clipboard API is denied", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    document.execCommand = vi.fn(() => true);
    const field = document.createElement("input");
    field.value = "C:\\x";
    document.body.appendChild(field);
    const select = vi.spyOn(field, "select");

    expect(await copyText("C:\\x", field)).toBe(true);
    expect(select).toHaveBeenCalled();
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("reports failure when neither method works", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    expect(await copyText("C:\\x")).toBe(false);
  });
});
