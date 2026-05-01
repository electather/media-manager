// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { useIsMobile } from "../use-is-mobile";

function mockMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const mq = {
    matches,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  vi.spyOn(window, "matchMedia").mockReturnValue(mq as unknown as MediaQueryList);
  return {
    listeners,
    setMatches: (next: boolean) => {
      mq.matches = next;
      listeners.forEach((cb) => cb());
    },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useIsMobile", () => {
  it("returns true when viewport matches mobile query", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("returns false when viewport does not match mobile query", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("updates when media query fires a change event", () => {
    const { setMatches } = mockMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    act(() => setMatches(true));
    expect(result.current).toBe(true);
    act(() => setMatches(false));
    expect(result.current).toBe(false);
  });

  it("removes listener on unmount", () => {
    const { listeners } = mockMatchMedia(false);
    const { unmount } = renderHook(() => useIsMobile());
    expect(listeners.size).toBe(1);
    unmount();
    expect(listeners.size).toBe(0);
  });
});
