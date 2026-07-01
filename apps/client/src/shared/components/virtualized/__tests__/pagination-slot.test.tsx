// @vitest-environment happy-dom
import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { PaginationSlot } from "../pagination-slot";
import { usePaginationSlot } from "../use-pagination-slot";

afterEach(cleanup);

const base = {
  itemCount: 3,
  hasNextPage: true,
  isFetchingNextPage: false,
  error: null as Error | null,
  fetchNextPage: () => undefined,
};

describe("usePaginationSlot", () => {
  it("reports loading while a next page is in flight, even over a pending error", () => {
    // The retry spinner must win: a fetch that both errored and is re-fetching
    // shows loading, not a stale error card (#888).
    const { result } = renderHook(() =>
      usePaginationSlot({ ...base, isFetchingNextPage: true, error: new Error("boom") }),
    );
    expect(result.current.state).toBe("loading");
    expect(result.current.isRetrying).toBe(true);
  });

  it("reports error only after items already loaded — an append failure, not initial load", () => {
    const appended = renderHook(() => usePaginationSlot({ ...base, error: new Error("boom") }));
    expect(appended.result.current.state).toBe("error");

    // itemCount 0 = the initial read failed; that belongs to the ErrorBoundary,
    // so the slot stays silent here.
    const initial = renderHook(() =>
      usePaginationSlot({ ...base, itemCount: 0, error: new Error("boom") }),
    );
    expect(initial.result.current.state).toBe("none");
  });

  it("reports none when idle with no error", () => {
    const { result } = renderHook(() => usePaginationSlot(base));
    expect(result.current.state).toBe("none");
  });

  it("retry calls fetchNextPage", () => {
    const fetchNextPage = vi.fn();
    const { result } = renderHook(() => usePaginationSlot({ ...base, fetchNextPage }));
    result.current.retry();
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });
});

describe("PaginationSlot", () => {
  it("renders nothing for the none state", () => {
    const { container } = render(
      <PaginationSlot
        slot={{ state: "none", error: null, isRetrying: false, retry: () => undefined }}
        variant="row"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("surfaces the append error with a working retry button", () => {
    const retry = vi.fn();
    render(
      <PaginationSlot
        slot={{ state: "error", error: new Error("boom"), isRetrying: false, retry }}
        variant="row"
      />,
    );
    const button = screen.getByRole("button");
    button.click();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("disables retry while re-fetching so a second page is not queued", () => {
    render(
      <PaginationSlot
        slot={{ state: "loading", error: null, isRetrying: true, retry: () => undefined }}
        variant="card"
      />,
    );
    expect(screen.getByTestId("pagination-slot-loading")).toBeTruthy();
  });
});
