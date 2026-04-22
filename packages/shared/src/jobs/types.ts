import type { JSONSchema } from "../common";
import type { JobKind, JobRunStatus, JobTriggeredBy } from "./enums";

/** Summary of a single past run surfaced through the admin API. */
export interface JobRunSummary {
  id: string;
  jobId: string;
  scopeKey: string | null;
  status: JobRunStatus;
  triggeredBy: JobTriggeredBy;
  triggeredByUserId: string | null;
  startedAt: number;
  finishedAt: number | null;
  durationMs: number | null;
  requestId: string;
  rowsTotal: number | null;
  rowsSucceeded: number | null;
  rowsFailed: number | null;
  errorRecordId: string | null;
  result: string | null;
  logs: string | null;
  logsTruncated: number | null;
  coalescedCount: number | null;
}

/** Baseline handle every registered job exposes. Specific kinds extend this. */
export interface JobHandle {
  id: string;
  name: string;
  description?: string;
  kind: JobKind;
  enabled: boolean;
  adminTriggerable: boolean;
  userTriggerable: boolean;
  inputSchema?: JSONSchema;
  schedule?: string;
  scheduleOverride?: string | null;
  effectiveSchedule?: string;
  lastRun?: JobRunSummary;
  /** Serialized as ISO string over the wire; Date on server. */
  nextRun?: string | Date;
}
