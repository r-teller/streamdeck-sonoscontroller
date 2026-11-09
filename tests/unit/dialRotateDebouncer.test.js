import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

import {
  DIAL_DEBOUNCE_MS,
  handleDialRotate,
  cleanupDialRotate,
  _resetDialRotateState,
} from "@/modules/plugin/dialRotateDebouncer.js";

beforeEach(() => {
  vi.useFakeTimers();
  _resetDialRotateState();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("dialRotateDebouncer", () => {
  test("burst of ticks debounced into a single dispatch", () => {
    const dispatch = vi.fn();

    handleDialRotate({ context: "c1", ticks: 2, dispatch });
    vi.advanceTimersByTime(100);
    handleDialRotate({ context: "c1", ticks: 3, dispatch });
    vi.advanceTimersByTime(100);
    handleDialRotate({ context: "c1", ticks: -1, dispatch });
    // still within debounce window
    vi.advanceTimersByTime(299);
    expect(dispatch).not.toHaveBeenCalled();

    // flush after total debounce period
    vi.advanceTimersByTime(1);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({
      inContext: "c1",
      inEvent: "dialRotate",
      inRotation: 4, // 2+3-1
    });
  });

  test("all-negative burst sums to negative rotation", () => {
    const dispatch = vi.fn();
    handleDialRotate({ context: "c2", ticks: -5, dispatch });
    vi.advanceTimersByTime(150);
    handleDialRotate({ context: "c2", ticks: -2, dispatch });
    vi.advanceTimersByTime(DIAL_DEBOUNCE_MS);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({
      inContext: "c2",
      inEvent: "dialRotate",
      inRotation: -7,
    });
  });

  test("window re‑arms correctly", () => {
    const dispatch = vi.fn();
    handleDialRotate({ context: "c3", ticks: 1, dispatch });
    vi.advanceTimersByTime(250);
    handleDialRotate({ context: "c3", ticks: 2, dispatch });
    // 300ms after first tick but only 50ms after last → no dispatch yet
    vi.advanceTimersByTime(50);
    expect(dispatch).not.toHaveBeenCalled();

    // 300ms after last tick (total 550ms) → dispatch
    vi.advanceTimersByTime(250);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({
      inContext: "c3",
      inEvent: "dialRotate",
      inRotation: 3,
    });
  });

  test("per‑context isolation", () => {
    const dispatchA = vi.fn();
    const dispatchB = vi.fn();

    handleDialRotate({ context: "cA", ticks: 4, dispatch: dispatchA });
    handleDialRotate({ context: "cB", ticks: -3, dispatch: dispatchB });
    vi.advanceTimersByTime(DIAL_DEBOUNCE_MS);

    expect(dispatchA).toHaveBeenCalledOnce();
    expect(dispatchA).toHaveBeenCalledWith({
      inContext: "cA",
      inEvent: "dialRotate",
      inRotation: 4,
    });
    expect(dispatchB).toHaveBeenCalledOnce();
    expect(dispatchB).toHaveBeenCalledWith({
      inContext: "cB",
      inEvent: "dialRotate",
      inRotation: -3,
    });
  });

  test("cleanupDialRotate cancels pending dispatch", () => {
    const dispatch = vi.fn();
    handleDialRotate({ context: "c4", ticks: 5, dispatch });
    cleanupDialRotate("c4");
    vi.advanceTimersByTime(1000);
    expect(dispatch).not.toHaveBeenCalled();

    // unknown context should not throw
    expect(() => cleanupDialRotate("unknown")).not.toThrow();
  });

  test("state resets after flush, allowing a second independent burst", () => {
    const dispatch = vi.fn();
    // first burst
    handleDialRotate({ context: "c5", ticks: 1, dispatch });
    vi.advanceTimersByTime(DIAL_DEBOUNCE_MS);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({
      inContext: "c5",
      inEvent: "dialRotate",
      inRotation: 1,
    });

    dispatch.mockReset();

    // second burst
    handleDialRotate({ context: "c5", ticks: 3, dispatch });
    vi.advanceTimersByTime(DIAL_DEBOUNCE_MS);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith({
      inContext: "c5",
      inEvent: "dialRotate",
      inRotation: 3,
    });
  });
});
