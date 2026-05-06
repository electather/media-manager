// @vitest-environment happy-dom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useInterval } from "../use-interval";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("useInterval", () => {
  it("calls the callback on each tick of the configured delay", () => {
    const cb = vi.fn();
    renderHook(() => useInterval(cb, 100));
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(350);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("uses the latest callback without resetting the interval", () => {
    let value: string = "a";
    const { rerender } = renderHook(({ cb }: { cb: () => void }) => useInterval(cb, 100), {
      initialProps: { cb: () => (value = "first") },
    });
    vi.advanceTimersByTime(100);
    expect(value).toBe("first");

    rerender({ cb: () => (value = "second") });
    vi.advanceTimersByTime(100);
    expect(value).toBe("second");
  });

  it("does not start a timer when delayMs is null", () => {
    const setSpy = vi.spyOn(window, "setInterval");
    renderHook(() => useInterval(vi.fn(), null));
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });

  it("clears the interval on unmount", () => {
    const clearSpy = vi.spyOn(window, "clearInterval");
    const { unmount } = renderHook(() => useInterval(vi.fn(), 50));
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("restarts the interval when the delay changes", () => {
    const cb = vi.fn();
    const { rerender } = renderHook(({ d }) => useInterval(cb, d), {
      initialProps: { d: 100 as number | null },
    });
    vi.advanceTimersByTime(100);
    expect(cb).toHaveBeenCalledTimes(1);

    rerender({ d: 50 });
    vi.advanceTimersByTime(50);
    expect(cb).toHaveBeenCalledTimes(2);

    rerender({ d: null });
    vi.advanceTimersByTime(500);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
