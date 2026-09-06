import { SonosController } from "../common/sonosController.js";
import { globalSettings } from "../plugin/globalSettings.js";

/**
 * Creates a fresh SonosController instance and connects it to the given host.
 * Optionally binds a UUID for coordinator routing.
 * @param {string} hostAddress - The host address of the Sonos device.
 * @param {string} [uuid] - Optional UUID of the speaker for coordinator routing.
 * @returns {SonosController} A connected SonosController instance.
 */
export function makeController(hostAddress, uuid) {
  return new SonosController().connect(hostAddress, { uuid });
}

/**
 * Returns the action timeout in milliseconds.
 * Uses globalSettings.deviceTimeoutDuration if set, otherwise defaults to 10.
 * @returns {number} Timeout in milliseconds.
 */
export function actionTimeoutMs() {
  return (globalSettings.deviceTimeoutDuration ?? 10) * 1000;
}

/**
 * Wraps a promise with a timeout. Rejects with a descriptive error if the timeout elapses first.
 * Always clears the timer in all outcomes.
 * @param {Promise<*>} promise - The promise to race against the timeout.
 * @param {string} label - A descriptive label for the operation (used in error message).
 * @returns {Promise<*>} A promise that resolves with the original promise's value or rejects with a timeout error.
 */
export function raceWithTimeout(promise, label) {
  const timeoutMs = actionTimeoutMs();
  const seconds = timeoutMs / 1000;
  let timerId = null;

  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      reject(new Error(`Timeout while running ${label} after ${seconds} seconds`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
  });
}

/**
 * Resolves the volume increment to use, prioritizing per-button setting over global.
 * Returns the first valid number ≥ 1 found, otherwise defaults to 10.
 * @param {Object} [settings] - Per-button settings object (optional).
 * @returns {number} The resolved volume increment.
 */
export function resolveVolumeIncrement(settings) {
  const perButton = settings?.adjustVolumeIncrement;
  if (typeof perButton === "number" && Number.isFinite(perButton) && perButton >= 1) {
    return perButton;
  }

  const global = globalSettings.adjustVolumeIncrement;
  if (typeof global === "number" && Number.isFinite(global) && global >= 1) {
    return global;
  }

  return 10;
}

/**
 * Ordered list of supported play modes.
 * @type {ReadonlyArray<string>}
 */
export const PLAY_MODES = Object.freeze([
  "NORMAL",
  "SHUFFLE_NOREPEAT",
  "SHUFFLE_REPEAT_ONE",
  "SHUFFLE",
  "REPEAT_ONE",
  "REPEAT_ALL",
]);

/**
 * Ordered list of supported input sources.
 * @type {ReadonlyArray<string>}
 */
export const INPUT_SOURCES = Object.freeze(["Sonos_Queue", "TV_Input", "Line_In"]);

/**
 * Maps input source names to their URI prefix and suffix components.
 * Keys are uppercase input source names.
 * Values are [prefix, suffix] arrays.
 * @type {Readonly<{
 *   SONOS_QUEUE: [string, string],
 *   TV_INPUT: [string, string],
 *   LINE_IN: [string, string]
 * }>}
 */
export const INPUT_SOURCE_PREFIX = Object.freeze({
  SONOS_QUEUE: ["x-rincon-queue:", "#0"],
  TV_INPUT: ["x-sonos-htastream:", ":spdif"],
  LINE_IN: ["x-rincon-stream:", ""],
});

/**
 * Maps equalizer target names to their layout file paths.
 * @type {Readonly<{
 *   VOLUME: string,
 *   BASS: string,
 *   TREBLE: string
 * }>}
 */
export const EQ_LAYOUTS = Object.freeze({
  VOLUME: "./layouts/encoder-bar-0-100.json",
  BASS: "./layouts/encoder-gbar-10-10.json",
  TREBLE: "./layouts/encoder-gbar-10-10.json",
});
