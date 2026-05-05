import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  DIAL_DEBOUNCE_MS,
  handleDialRotate,
  cleanupDialRotate,
  _resetDialRotateDebouncer,
  _getRotationAmount,
} from "@/modules/plugin/dialRotateDebouncer.js";

describe("dialRotateDebouncer (etr.6 AC)", () => {
  let dispatch;

  beforeEach(() => {
    _resetDialRotateDebouncer();
    vi.useFakeTimers();
    dispatch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("DIAL_DEBOUNCE_MS = 300", () => {
    expect(DIAL_DEBOUNCE_MS).toBe(300);
  });

  it("AC: a single tick accumulates 1 and flushes 300ms later", () => {
    handleDialRotate({ context: "ctx-1", ticks: 1 }, { callAction: dispatch });
    expect(_getRotationAmount("ctx-1")).toBe(1);
    expect(dispatch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(299);
    expect(dispatch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      inContext: "ctx-1",
      inEvent: "dialRotate",
      inRotation: 1,
    });
  });

  it("AC: 5 ticks within 100ms produce EXACTLY ONE callAction with summed delta", () => {
    for (let i = 0; i < 5; i++) {
      handleDialRotate({ context: "ctx-1", ticks: 1 }, { callAction: dispatch });
      vi.advanceTimersByTime(20); // 5 × 20ms = 100ms total
    }
    expect(dispatch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      inContext: "ctx-1",
      inEvent: "dialRotate",
      inRotation: 5,
    });
  });

  it("AC: signed mix of CW/CCW ticks accumulates correctly", () => {
    handleDialRotate({ context: "ctx-1", ticks: 3 }, { callAction: dispatch });
    handleDialRotate({ context: "ctx-1", ticks: -1 }, { callAction: dispatch });
    handleDialRotate({ context: "ctx-1", ticks: 2 }, { callAction: dispatch });
    vi.advanceTimersByTime(300);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0].inRotation).toBe(4);
  });

  it("AC: after a flush, the accumulator resets and a new tick starts a fresh window", () => {
    handleDialRotate({ context: "ctx-1", ticks: 2 }, { callAction: dispatch });
    vi.advanceTimersByTime(300);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(_getRotationAmount("ctx-1")).toBe(0);

    handleDialRotate({ context: "ctx-1", ticks: 7 }, { callAction: dispatch });
    expect(_getRotationAmount("ctx-1")).toBe(7);
    vi.advanceTimersByTime(300);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[1][0].inRotation).toBe(7);
  });

  it("each tick re-arms the debounce window — flush only happens 300ms after the LAST tick", () => {
    handleDialRotate({ context: "ctx-1", ticks: 1 }, { callAction: dispatch });
    vi.advanceTimersByTime(200);
    handleDialRotate({ context: "ctx-1", ticks: 1 }, { callAction: dispatch });
    vi.advanceTimersByTime(200);
    // 400ms total elapsed but no flush yet — the second tick reset the window.
    expect(dispatch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(101);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("AC: cleanupDialRotate cancels pending flush AND zeros the accumulator (no zombie dispatch)", () => {
    handleDialRotate({ context: "ctx-1", ticks: 4 }, { callAction: dispatch });
    cleanupDialRotate("ctx-1");
    vi.advanceTimersByTime(500);
    expect(dispatch).not.toHaveBeenCalled();
    expect(_getRotationAmount("ctx-1")).toBe(0);
  });

  it("per-context: ticks on ctx-1 do not flush ticks on ctx-2 and vice versa", () => {
    handleDialRotate({ context: "ctx-1", ticks: 2 }, { callAction: dispatch });
    handleDialRotate({ context: "ctx-2", ticks: 5 }, { callAction: dispatch });
    vi.advanceTimersByTime(300);
    expect(dispatch).toHaveBeenCalledTimes(2);
    const callsByCtx = dispatch.mock.calls.reduce((acc, c) => {
      acc[c[0].inContext] = c[0].inRotation;
      return acc;
    }, {});
    expect(callsByCtx).toEqual({ "ctx-1": 2, "ctx-2": 5 });
  });
});
