import type { ErrorsFilters, PerfFilters } from "./types";

/** The subset of perf filters the aggregate fetcher actually transmits to the
 *  server (`since` via `range`, plus `kind` and `requestId`). `sort` and
 *  `search` are applied client-side, so they stay out of the query key — a
 *  sort/search change re-derives from the cached data without a refetch. */
export type PerfAggregateKeyFilters = Pick<PerfFilters, "range" | "kind" | "requestId">;

export const diagnosticsKeys = {
  all: ["diagnostics"] as const,
  config: () => [...diagnosticsKeys.all, "config"] as const,
  errors: {
    all: () => [...diagnosticsKeys.all, "errors"] as const,
    list: (filters: ErrorsFilters) => [...diagnosticsKeys.all, "errors", "list", filters] as const,
    summary: () => [...diagnosticsKeys.all, "errors", "summary"] as const,
    detail: (id: string) => [...diagnosticsKeys.all, "errors", "detail", id] as const,
  },
  perf: {
    all: () => [...diagnosticsKeys.all, "perf"] as const,
    aggregate: ({ range, kind, requestId }: PerfAggregateKeyFilters) =>
      [...diagnosticsKeys.all, "perf", "aggregate", { range, kind, requestId }] as const,
    summary: () => [...diagnosticsKeys.all, "perf", "summary"] as const,
    detail: (id: string) => [...diagnosticsKeys.all, "perf", "detail", id] as const,
    detailDisabled: () => [...diagnosticsKeys.all, "perf", "detail", "disabled"] as const,
  },
} as const;
