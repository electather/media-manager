import type { ErrorSeverity, ErrorSource, PerfKind } from "./enums";

/** Fully-shaped error record written to each registered diagnostic sink. */
export interface ErrorRecord {
  id: string;
  requestId: string;
  severity: ErrorSeverity;
  source: ErrorSource;
  code: string | null;
  devMessage: string;
  stack: string | null;
  userId: string | null;
  pluginId: string | null;
  connectionId: string | null;
  route: string | null;
  httpStatus: number | null;
  /** Scrubbed, JSON-encoded; null when there was nothing to attach. */
  context: string | null;
  createdAt: number;
}

/** Fully-shaped perf record written to each registered diagnostic sink.
 *  HTTP rows carry method/status/route (param path); plugin rows carry pluginId
 *  and use `route` as the invoked method name (e.g. `connections.test`). */
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
