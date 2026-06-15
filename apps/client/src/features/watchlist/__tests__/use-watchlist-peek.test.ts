// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vite-plus/test";
import { renderHook, act } from "@testing-library/react";
import { useWatchlistPeek } from "../hooks/use-watchlist-peek";

// Stub useNavigate so we can assert the exact args passed — this locks the
// peek-modal navigation contract that all eight section components rely on.
const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

describe("useWatchlistPeek", () => {
  it("calls navigate with the correct peek contract when invoked", () => {
    const { result } = renderHook(() => useWatchlistPeek());

    act(() => {
      result.current("tt0111161");
    });

    expect(navigateMock).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const call: {
      to: string;
      replace: boolean;
      resetScroll: boolean;
      search: (p: Record<string, unknown>) => unknown;
    } = navigateMock.mock.calls[0]![0];
    // Route stays at current location.
    expect(call.to).toBe(".");
    // replace:false so the peek can be dismissed with the back button.
    expect(call.replace).toBe(false);
    // resetScroll:false so the user returns to the same scroll position.
    expect(call.resetScroll).toBe(false);
    // search merges peek into current params.
    const merged = call.search({ sort: "recent" });
    expect(merged).toEqual({ sort: "recent", peek: "tt0111161" });
  });

  it("returns a stable callback reference across re-renders", () => {
    const { result, rerender } = renderHook(() => useWatchlistPeek());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
