import type { ErrorsFilters, PerfFilters } from "./types";

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
    aggregate: (filters: PerfFilters) =>
      [...diagnosticsKeys.all, "perf", "aggregate", filters] as const,
    summary: () => [...diagnosticsKeys.all, "perf", "summary"] as const,
    detail: (id: string) => [...diagnosticsKeys.all, "perf", "detail", id] as const,
    list: (filters: PerfFilters) => [...diagnosticsKeys.all, "perf", "list", filters] as const,
  },
} as const;
