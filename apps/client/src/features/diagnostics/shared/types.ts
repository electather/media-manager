import type {
  ErrorRecord,
  ErrorSeverity,
  ErrorSource,
  PerfKind,
  PerfRecord,
} from "@nama/shared/diagnostics";
import { ERROR_SEVERITIES, ERROR_SOURCES } from "@nama/shared/diagnostics";
import { m } from "@/paraglide/messages";
import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";

/** Filter state owned by the diagnostics route — encoded in search params. */
export interface ErrorsFilters {
  severity: ErrorSeverity[];
  source: ErrorSource[];
  pluginId: string | null;
  range: "24h" | "7d" | "30d";
  requestId: string;
  search: string;
}

export interface PerfFilters {
  kind: "all" | PerfKind;
  sort: "p50" | "p95" | "p99" | "max" | "count" | "lastAt";
  range: "24h" | "7d" | "30d";
  requestId: string;
  search: string;
}

/** Default filter state for each tab. Lives here so the filter bars and the
 *  filter hook share one source rather than the hook importing initialization
 *  state from a component file. */
export const ERRORS_DEFAULT_FILTERS: ErrorsFilters = {
  severity: [...ERROR_SEVERITIES],
  source: [...ERROR_SOURCES],
  pluginId: null,
  range: "24h",
  requestId: "",
  search: "",
};

export const PERF_DEFAULT_FILTERS: PerfFilters = {
  kind: "all",
  sort: "p95",
  range: "24h",
  requestId: "",
  search: "",
};

/** Enum label functions shared by every call site so the i18n mapping lives in
 *  one place per enum. */
export const SOURCE_LABELS: Record<ErrorSource, () => string> = {
  frontend: () => m.diagnostics_source_frontend(),
  backend: () => m.diagnostics_source_backend(),
  plugin: () => m.diagnostics_source_plugin(),
  cron: () => m.diagnostics_source_cron(),
};

export const PERF_LABELS: Record<"p50" | "p95" | "p99" | "max", () => string> = {
  p50: () => m.diagnostics_perf_label_p50(),
  p95: () => m.diagnostics_perf_label_p95(),
  p99: () => m.diagnostics_perf_label_p99(),
  max: () => m.diagnostics_perf_label_max(),
};

/** Wire shape returned by `/admin/diagnostics/errors` list endpoint. List rows
 *  drop the heavyweight detail fields (`stack`, `resolvedStack`, `context`,
 *  `connectionId`) — the detail sheet refetches the full {@link ErrorDetail}
 *  when opened. */
export type ErrorListRow = Omit<
  ErrorRecord,
  "stack" | "resolvedStack" | "context" | "connectionId"
>;

/** Detail view re-uses the canonical record shape from `@nama/shared`. */
export type ErrorDetail = ErrorRecord;

export interface ErrorsSummary {
  lastHour: number;
  last24h: number;
  hourlyBuckets: Array<{ error: number; warning: number; info: number }>;
}

export interface PerfAggregateGroup {
  kind: PerfKind;
  route: string | null;
  pluginId: string | null;
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  lastAt: number;
}

export interface PerfAggregateResponse {
  groups: PerfAggregateGroup[];
  window: { since: number; until: number };
  truncated: boolean;
  sampleSize: number;
}

export interface PerfSummaryResponse {
  requestsPerMinute: number;
  p50: number;
  p95: number;
  p99: number;
  hourlySeries: Array<{ count: number; p50: number; p95: number }>;
}

/** Re-export the canonical perf-record shape; the wire payload is identical. */
export type { PerfRecord };

export interface PerfDetailResponse {
  record: PerfRecord;
  correlatedErrors: Array<{
    id: string;
    severity: ErrorSeverity;
    code: string | null;
    devMessage: string;
    createdAt: number;
  }>;
}

export interface DiagnosticsConfig {
  errorRetentionDays: number;
  perfRetentionDays: number;
}

/** Typed error class thrown by fetchers when the diagnostics API responds with
 *  a non-2xx status. The wire body follows the standard `{ code, devMessage,
 *  requestId }` envelope. */
export class DiagnosticsApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody | null,
  ) {
    super(body?.devMessage ?? `Diagnostics API ${status}`);
    this.name = "DiagnosticsApiError";
  }
}
