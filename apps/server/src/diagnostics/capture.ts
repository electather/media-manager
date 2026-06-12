import { consola } from "consola";
import type {
  ErrorRecord,
  ErrorSeverity,
  ErrorSource,
  PerfKind,
  PerfRecord,
} from "@ent-mcp/shared/diagnostics";
import { severityFor } from "@ent-mcp/shared/diagnostics";
import { currentRequestContext, newRequestId } from "./request-context";
import { scrubText, serializeContext } from "./scrubber";
import type { DiagnosticSink } from "./types";
import { isNil } from "es-toolkit/predicate";

export interface CaptureMeta {
  /** Optional severity override. When omitted, `captureError` derives it from
   *  `code` via the registry in `./codes`. Pass explicitly to bump a normally
   *  `error`-classified code down to `warning` (or `info`) on a recovered or
   *  user-input path. */
  severity?: ErrorSeverity;
  source: ErrorSource;
  code?: string;
  route?: string;
  userId?: string | null;
  pluginId?: string | null;
  connectionId?: string | null;
  httpStatus?: number;
  requestId?: string;
  context?: Record<string, unknown>;
  /** When provided, overrides the message derived from `err`. */
  devMessage?: string;
  /** When provided, overrides the stack trace derived from `err`. */
  stack?: string;
  /** Stack already translated to original source positions via uploaded
   *  sourcemaps. Stored alongside the raw stack. */
  resolvedStack?: string;
}

export interface PerfCaptureMeta {
  kind: PerfKind;
  durationMs: number;
  route?: string | null;
  method?: string | null;
  status?: number | null;
  pluginId?: string | null;
  userId?: string | null;
  requestId?: string;
}

const sinks: DiagnosticSink[] = [];

/** Registers a sink that participates in every subsequent capture call. Sinks
 *  fire concurrently via `Promise.allSettled`, so each fails independently. */
export function registerSink(sink: DiagnosticSink): void {
  sinks.push(sink);
}

/** Clears all registered sinks. Primarily for tests. */
export function resetSinks(): void {
  sinks.length = 0;
}

// fallow-ignore-next-line complexity
function devMessageFrom(err: unknown): string {
  if (isNil(err)) return "unknown error";
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return Object.prototype.toString.call(err);
  }
}

function stackFrom(err: unknown): string | null {
  if (err instanceof Error && err.stack) return err.stack;
  return null;
}

/** Logs each rejected fan-out result the same way, tagging the message with the
 *  sink phase that produced it. */
function reportSinkRejections(label: string, results: PromiseSettledResult<unknown>[]): void {
  for (const result of results) {
    if (result.status === "rejected") {
      consola.error(`diagnostic sink (${label}) failed:`, result.reason);
    }
  }
}

/** Captures an error by building a record and fanning it out to all registered
 *  sinks via Promise.allSettled. `info`-severity records are stored alongside
 *  `warning` and `error` so admins can filter in the viewer — they represent
 *  expected user-input failures worth keeping for debug but excluded from the
 *  default dashboard view. */
export async function captureError(err: unknown, meta: CaptureMeta): Promise<string> {
  const record = buildErrorRecord(err, meta);
  const matched = sinks.filter((sink) => typeof sink.captureError === "function");
  const results = await Promise.allSettled(matched.map((sink) => sink.captureError!(record)));
  reportSinkRejections("error", results);
  return record.id;
}

/** Captures a perf row and fans it out to perf-aware sinks. Sink failures are
 *  swallowed — perf telemetry must never break a request. */
export async function capturePerf(meta: PerfCaptureMeta): Promise<void> {
  const record = buildPerfRecord(meta);
  const matched = sinks.filter((sink) => typeof sink.capturePerf === "function");
  if (matched.length === 0) return;
  const results = await Promise.allSettled(matched.map((sink) => sink.capturePerf!(record)));
  reportSinkRejections("perf", results);
}

// fallow-ignore-next-line complexity
function buildErrorRecord(err: unknown, meta: CaptureMeta): ErrorRecord {
  // Explicit `meta.severity` wins (callers bump recovered paths to `warning`); otherwise use the code's registered classification.
  const severity = meta.severity ?? severityFor(meta.code ?? "");
  const ctx = currentRequestContext();
  const rawStack = meta.stack ?? stackFrom(err);
  return {
    id: crypto.randomUUID(),
    requestId: meta.requestId ?? ctx?.requestId ?? newRequestId(),
    severity,
    source: meta.source,
    code: meta.code ?? null,
    devMessage: scrubText(meta.devMessage ?? devMessageFrom(err)),
    stack: rawStack != null ? scrubText(rawStack) : null,
    resolvedStack: meta.resolvedStack != null ? scrubText(meta.resolvedStack) : null,
    userId: meta.userId ?? ctx?.userId ?? null,
    pluginId: meta.pluginId ?? null,
    connectionId: meta.connectionId ?? null,
    route: meta.route ?? ctx?.route ?? null,
    httpStatus: meta.httpStatus ?? null,
    context: serializeContext(meta.context),
    createdAt: Date.now(),
  };
}

// Straight-line null-coalescing across the wire shape's optional fields;
// cyclomatic count reflects field count, not branching logic.
// fallow-ignore-next-line complexity
function buildPerfRecord(meta: PerfCaptureMeta): PerfRecord {
  const ctx = currentRequestContext();
  return {
    id: crypto.randomUUID(),
    requestId: meta.requestId ?? ctx?.requestId ?? newRequestId(),
    kind: meta.kind,
    durationMs: Math.max(0, Math.round(meta.durationMs)),
    route: meta.route ?? null,
    method: meta.method ?? null,
    status: meta.status ?? null,
    pluginId: meta.pluginId ?? null,
    userId: meta.userId ?? ctx?.userId ?? null,
    createdAt: Date.now(),
  };
}
