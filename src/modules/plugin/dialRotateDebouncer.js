export const DIAL_DEBOUNCE_MS = 300;

// Per-context state: accumulator and timer reference
const dialState = new Map();

/**
 * Handles dial rotation for a given context.
 * @param {Object} params - The parameters object.
 * @param {string} params.context - The context identifier.
 * @param {number} params.ticks - The number of ticks rotated (positive = clockwise).
 * @param {Function} params.dispatch - The dispatch function to call on flush.
 */
export function handleDialRotate({ context, ticks, dispatch }) {
  // Store the most recent dispatch function for this context
  if (!dialState.has(context)) {
    dialState.set(context, { accumulator: 0, timer: null, dispatch });
  }
  const state = dialState.get(context);
  state.dispatch = dispatch;

  // Add ticks to accumulator
  state.accumulator += ticks;

  // Clear existing timer and set new one (re-arms the window)
  if (state.timer) {
    clearTimeout(state.timer);
  }
  state.timer = setTimeout(() => {
    // Dispatch the accumulated rotation
    const sum = state.accumulator;
    // Reset accumulator and delete timer reference
    state.accumulator = 0;
    state.timer = null;
    // Call the stored dispatch function with the accumulated value
    state.dispatch({ inContext: context, inEvent: "dialRotate", inRotation: sum });
  }, DIAL_DEBOUNCE_MS);
}

/**
 * Cleans up dial rotation state for a given context.
 * @param {string} context - The context identifier.
 */
export function cleanupDialRotate(context) {
  const state = dialState.get(context);
  if (state) {
    if (state.timer) {
      clearTimeout(state.timer);
    }
    dialState.delete(context);
  }
}

/**
 * Resets all dial rotation state (test hook).
 */
export function _resetDialRotateState() {
  for (const [context, state] of dialState.entries()) {
    if (state.timer) {
      clearTimeout(state.timer);
    }
    dialState.delete(context);
  }
}
