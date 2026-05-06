// @vitest-environment happy-dom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useCopyFeedback } from "../use-copy-feedback";

function mockClipboard(impl: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: impl },
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("useCopyFeedback", () => {
  it("starts with copied=false", () => {
    const { result } = renderHook(() => useCopyFeedback());
    expect(result.current.copied).toBe(false);
  });

  it("flips copied to true after a successful copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);

    const { result } = renderHook(() => useCopyFeedback());

    await act(async () => {
      await result.current.copy("hello");
    });

    expect(writeText).toHaveBeenCalledWith("hello");
    expect(result.current.copied).toBe(true);
  });

  it("auto-resets copied to false after the configured delay", async () => {
    mockClipboard(vi.fn().mockResolvedValue(undefined));

    const { result } = renderHook(() => useCopyFeedback({ resetMs: 1000 }));

    await act(async () => {
      await result.current.copy("a");
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.copied).toBe(false);
  });

  it("debounces the reset across rapid copies", async () => {
    mockClipboard(vi.fn().mockResolvedValue(undefined));

    const { result } = renderHook(() => useCopyFeedback({ resetMs: 1500 }));

    await act(async () => {
      await result.current.copy("a");
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {
      await result.current.copy("b");
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.copied).toBe(false);
  });

  it("swallows clipboard rejections and stays not-copied", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));

    const { result } = renderHook(() => useCopyFeedback());

    await act(async () => {
      await result.current.copy("nope");
    });

    expect(result.current.copied).toBe(false);
  });

  it("clears its pending timer on unmount", async () => {
    mockClipboard(vi.fn().mockResolvedValue(undefined));
    const clearSpy = vi.spyOn(window, "clearTimeout");

    const { result, unmount } = renderHook(() => useCopyFeedback());
    await act(async () => {
      await result.current.copy("x");
    });

    unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
