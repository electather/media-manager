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

/** An *append* failure the slot's retry can actually recover: items already
 * loaded (not initial load) and a next page still exists to re-request (#888). */
function isRecoverableAppendError({
  itemCount,
  hasNextPage,
  error,
}: PaginationSlotSource): boolean {
  return error != null && itemCount > 0 && hasNextPage;
}

/**
 * Order matters: a fetch that errored but is now retrying reports `loading` so
 * the retry spinner wins over the stale error card. `error` only surfaces once
 * items exist (an *append* failure, not initial load) AND a next page exists —
 * on an exhausted list a failed background refetch has no page to retry, so the
 * slot's `fetchNextPage` retry can't recover it and must stay `none` (#888).
 */
function deriveState(source: PaginationSlotSource): PaginationSlotState {
  if (source.isFetchingNextPage) return "loading";
  if (isRecoverableAppendError(source)) return "error";
  return "none";
}

/**
 * Collapses an infinite query's `{ hasNextPage, isFetchingNextPage, error }`
 * into the single trailing-slot branch every virtualized list shares (#888):
 * `loading` while a page is in flight, `error` when the *append* page failed,
 * else `none`. Initial-load failure stays a caller concern (ErrorBoundary /
 * full-region fallback) — it never routes here.
 */
export function usePaginationSlot(source: PaginationSlotSource): PaginationSlot {
  const { isFetchingNextPage, error, fetchNextPage } = source;
  const retry = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);

  return { state: deriveState(source), error, isRetrying: isFetchingNextPage, retry };
}
