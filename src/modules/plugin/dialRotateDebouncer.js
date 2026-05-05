/**
 * dialRotate debouncer.
 *
 * Coalesces SD+ encoder rotary ticks per-context into a 300 ms window and
 * dispatches a single `callAction({inEvent: 'dialRotate'})` per window.
 * Required by Audio Equalizer (km1.11) so a fast spin produces one
 * `SetVolume` / `SetBass` / `SetTreble` call rather than one per tick.
 *
 * Per prd-what.md §8.1 / §5.11.
 */

import { callAction } from "./actionDispatcher.js";

export const DIAL_DEBOUNCE_MS = 300;

const rotationAmount = {};
const rotationDebounceTimer = {};

/**
 * Accumulate `ticks` (signed integer) for `context` and (re)schedule a flush
 * 300ms after the most recent tick. The flush invokes the dispatcher with
 * the summed delta, then resets the accumulator.
 *
 * @param {object} args
 * @param {string} args.context — Stream Deck context ID.
 * @param {number} args.ticks — Signed delta (positive = CW, negative = CCW).
 * @param {object} [deps] — Test injectables.
 * @param {Function} [deps.callAction] — Override the dispatcher (default
 *   uses the real one from etr.4).
 */
export function handleDialRotate(
  { context, ticks } = {},
  { callAction: callActionImpl = callAction } = {},
) {
  rotationAmount[context] = (rotationAmount[context] || 0) + (ticks || 0);

  if (rotationDebounceTimer[context] != null) {
    clearTimeout(rotationDebounceTimer[context]);
  }

  rotationDebounceTimer[context] = setTimeout(() => {
    const accumulated = rotationAmount[context] || 0;
    rotationAmount[context] = 0;
    delete rotationDebounceTimer[context];
    callActionImpl({
      inContext: context,
      inEvent: "dialRotate",
      inRotation: accumulated,
    });
  }, DIAL_DEBOUNCE_MS);
}

/**
 * Cancel any pending flush and zero the accumulator for `context`.
 * Called from the lifecycle handler (etr.5) on `willDisappear` so a
 * removed context doesn't fire a zombie flush.
 */
export function cleanupDialRotate(context) {
  if (rotationDebounceTimer[context] != null) {
    clearTimeout(rotationDebounceTimer[context]);
    delete rotationDebounceTimer[context];
  }
  delete rotationAmount[context];
}

/** Test-only: clear all pending state. */
export function _resetDialRotateDebouncer() {
  for (const ctx of Object.keys(rotationDebounceTimer)) {
    clearTimeout(rotationDebounceTimer[ctx]);
    delete rotationDebounceTimer[ctx];
  }
  for (const ctx of Object.keys(rotationAmount)) {
    delete rotationAmount[ctx];
  }
}

/** Test-only: read the current accumulated delta. */
export function _getRotationAmount(context) {
  return rotationAmount[context] || 0;
}
