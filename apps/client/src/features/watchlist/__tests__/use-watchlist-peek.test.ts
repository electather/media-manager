// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { renderHook, act } from "@testing-library/react";
import { useWatchlistPeek } from "../hooks/use-watchlist-peek";

// Stub useNavigate so we can assert the exact args passed — this locks the
// peek-modal navigation contract that all eight section components rely on.
const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
}));

describe("useWatchlistPeek", () => {
  beforeEach(() => {
    navigateMock.mockClear();
  });

  it("calls navigate with the correct peek contract when invoked", () => {
    const { result } = renderHook(() => useWatchlistPeek());

    act(() => {
      result.current("tt0111161");
    });

    expect(navigateMock).toHaveBeenCalledOnce();
    const [callArg] = navigateMock.mock.calls[0]!;
    // Route stays at current location; replace:false allows back-button dismiss;
    // resetScroll:false preserves the user's scroll position on dismiss.
    expect(callArg).toMatchObject({ to: ".", replace: false, resetScroll: false });
    // search must merge peek into the existing params, not replace them.
    const merged = (callArg as { search: (p: Record<string, unknown>) => unknown }).search({
      sort: "recent",
    });
    expect(merged).toEqual({ sort: "recent", peek: "tt0111161" });
  });

  it("returns a stable callback reference across re-renders", () => {
    const { result, rerender } = renderHook(() => useWatchlistPeek());
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
