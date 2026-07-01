import { useCallback } from "react";

/** The trailing-slot render branch derived from an infinite query's state. */
export type PaginationSlotState = "loading" | "error" | "none";

export interface PaginationSlotSource {
  /** Items already loaded; the error branch only fires once > 0 (an *append* failure, not initial load). */
  itemCount: number;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  error: Error | null;
  fetchNextPage: () => unknown;
}

export interface PaginationSlot {
  state: PaginationSlotState;
  error: Error | null;
  isRetrying: boolean;
  retry: () => void;
}

/**
 * Collapses an infinite query's `{ hasNextPage, isFetchingNextPage, error }`
 * into the single trailing-slot branch every virtualized list shares (#888):
 * `loading` while a page is in flight, `error` when the *append* page failed
 * after items already loaded, else `none`. Initial-load failure stays a caller
 * concern (ErrorBoundary / full-region fallback) — it never routes here.
 * Order matters: a fetch that errored but is now retrying reports `loading` so
 * the retry spinner wins over the stale error card.
 */
export function usePaginationSlot({
  itemCount,
  isFetchingNextPage,
  error,
  fetchNextPage,
}: PaginationSlotSource): PaginationSlot {
  const retry = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  const state: PaginationSlotState = isFetchingNextPage
    ? "loading"
    : error != null && itemCount > 0
      ? "error"
      : "none";

  return { state, error, isRetrying: isFetchingNextPage, retry };
}
