export type ErrorSeverity = "error" | "warning";
export type ErrorSource = "frontend" | "backend" | "plugin" | "cron";

/** Fully-shaped record written to each registered sink. */
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

/** Pluggable destination for captured errors. V1 ships a DatabaseSink only.
 *  Downstream sinks fail independently via Promise.allSettled. */
export interface ErrorSink {
  capture(record: ErrorRecord): Promise<void>;
}
