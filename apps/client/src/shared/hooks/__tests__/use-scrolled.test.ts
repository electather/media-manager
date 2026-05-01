// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useScrolled } from "../use-scrolled";

function setScrollY(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, writable: true, configurable: true });
  window.dispatchEvent(new Event("scroll"));
}

beforeEach(() => {
  setScrollY(0);
});

afterEach(() => {
  cleanup();
});

describe("useScrolled", () => {
  it("returns false when scrollY is below threshold", () => {
    const { result } = renderHook(() => useScrolled());
    expect(result.current).toBe(false);
  });

  it("returns false when scrollY equals the threshold (> not >=)", () => {
    setScrollY(8);
    const { result } = renderHook(() => useScrolled());
    expect(result.current).toBe(false);
  });

  it("returns true when scrollY exceeds the default threshold", () => {
    const { result } = renderHook(() => useScrolled());
    act(() => setScrollY(9));
    expect(result.current).toBe(true);
  });

  it("respects a custom threshold", () => {
    const { result } = renderHook(() => useScrolled(20));
    act(() => setScrollY(15));
    expect(result.current).toBe(false);
    act(() => setScrollY(21));
    expect(result.current).toBe(true);
  });

  it("toggles back to false when scrolling below threshold", () => {
    const { result } = renderHook(() => useScrolled());
    act(() => setScrollY(50));
    expect(result.current).toBe(true);
    act(() => setScrollY(0));
    expect(result.current).toBe(false);
  });

  it("registers a passive scroll listener", () => {
    const spy = vi.spyOn(window, "addEventListener");
    renderHook(() => useScrolled());
    const call = spy.mock.calls.find(([event]) => event === "scroll");
    expect(call?.[2]).toMatchObject({ passive: true });
    spy.mockRestore();
  });

  it("removes the scroll listener on unmount", () => {
    const spy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useScrolled());
    unmount();
    expect(spy.mock.calls.some(([event]) => event === "scroll")).toBe(true);
    spy.mockRestore();
  });
});
