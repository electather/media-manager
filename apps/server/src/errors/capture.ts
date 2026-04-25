import { consola } from "consola";
import type { ErrorRecord, ErrorSeverity, ErrorSource } from "@ent-mcp/shared/errors";
import { severityFor } from "@ent-mcp/shared/errors";
import { currentRequestContext, newRequestId } from "./request-context";
import { serializeContext } from "./scrubber";
import type { ErrorSink } from "./types";

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
}

const sinks: ErrorSink[] = [];

/** Registers a sink that participates in every subsequent captureError call. Sinks
 *  fire concurrently via Promise.allSettled, so each fails independently. */
export function registerErrorSink(sink: ErrorSink): void {
  sinks.push(sink);
}

/** Clears all registered sinks. Primarily for tests. */
export function resetErrorSinks(): void {
  sinks.length = 0;
}

function devMessageFrom(err: unknown): string {
  if (err === null || err === undefined) return "unknown error";
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

/** Central entry point for capturing an error. Looks up the effective severity
 *  from the codes registry (falling back to an explicit `meta.severity` when
 *  provided), builds the record, and fans it out to every registered sink via
 *  Promise.allSettled. `info`-severity records are stored alongside `warning`
 *  and `error` so admins can filter them in the viewer — per the error design
 *  doc, they represent expected user-input failures (bad URL, wrong password)
 *  that are worth keeping for debug but not surfacing on the default dashboard
 *  view. */
export async function captureError(err: unknown, meta: CaptureMeta): Promise<string> {
  const severity = resolveSeverity(meta);
  const ctx = currentRequestContext();
  const record: ErrorRecord = {
    id: crypto.randomUUID(),
    requestId: meta.requestId ?? ctx?.requestId ?? newRequestId(),
    severity,
    source: meta.source,
    code: meta.code ?? null,
    devMessage: meta.devMessage ?? devMessageFrom(err),
    stack: meta.stack ?? stackFrom(err),
    userId: meta.userId ?? ctx?.userId ?? null,
    pluginId: meta.pluginId ?? null,
    connectionId: meta.connectionId ?? null,
    route: meta.route ?? ctx?.route ?? null,
    httpStatus: meta.httpStatus ?? null,
    context: serializeContext(meta.context),
    createdAt: Date.now(),
  };

  const results = await Promise.allSettled(sinks.map((sink) => sink.capture(record)));
  for (const result of results) {
    if (result.status === "rejected") {
      consola.error("error sink failed:", result.reason);
    }
  }

  return record.id;
}

// Resolves the effective severity for a capture call. The explicit
// `meta.severity` wins when provided (callers bump recovered paths to
// `warning` this way); otherwise the code's registered classification is
// used. The registry's `ErrorCodeSeverity` type is the same set as the
// stored `ErrorSeverity`, so the return type narrows naturally.
function resolveSeverity(meta: CaptureMeta): ErrorSeverity {
  return meta.severity ?? severityFor(meta.code ?? "");
}
