import type { ErrorSeverity, ErrorSource } from "./enums";

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
