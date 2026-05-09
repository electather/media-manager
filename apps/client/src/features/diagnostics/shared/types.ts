import type { ErrorSeverity, ErrorSource, PerfKind } from "@ent-mcp/shared/diagnostics";
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

/** Wire shape returned by `/admin/diagnostics/errors` list endpoint. */
export interface ErrorListRow {
  id: string;
  requestId: string;
  severity: ErrorSeverity;
  source: ErrorSource;
  code: string | null;
  devMessage: string;
  route: string | null;
  httpStatus: number | null;
  userId: string | null;
  pluginId: string | null;
  createdAt: number;
}

export interface ErrorDetail extends ErrorListRow {
  stack: string | null;
  context: string | null;
  connectionId: string | null;
}

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

export interface PerfRecord {
  id: string;
  requestId: string;
  kind: PerfKind;
  durationMs: number;
  route: string | null;
  method: string | null;
  status: number | null;
  pluginId: string | null;
  userId: string | null;
  createdAt: number;
}

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
