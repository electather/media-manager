/** The single render branch a row resolves to, derived during render. */
export type RowStatus = "initial-error" | "skeletons" | "empty" | "ready";

/**
 * Collapses the row's `error` / `isLoading` / item-count signals into one
 * discriminant. Order matters: an error before any item arrived is a full-row
 * fallback; otherwise an empty first load shows skeletons; a resolved-but-empty
 * row collapses to nothing (a soft-degraded source leaves no blank gap). A
 * pagination error *after* items loaded stays `ready` — that case routes to
 * the shared `PaginationSlot` via `usePaginationSlot` (#888).
 */
// fallow-ignore-next-line complexity
export function rowStatus(s: {
  error: Error | null;
  isLoading: boolean;
  itemCount: number;
}): RowStatus {
  if (s.error !== null && s.itemCount === 0) return "initial-error";
  if (s.isLoading && s.itemCount === 0) return "skeletons";
  if (s.error === null && !s.isLoading && s.itemCount === 0) return "empty";
  return "ready";
}
