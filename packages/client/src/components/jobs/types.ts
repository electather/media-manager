export type JobRunStatus =
  | "running"
  | "succeeded"
  | "partial_failure"
  | "failed"
  | "skipped"
  | "timed_out"
  | "cancelled";

export type JobTriggeredBy = "cron" | "admin" | "user" | "feature";
export type JobKind = "scheduled" | "scheduled_per_row" | "triggerable" | "coalesced";

// Already defined in the server, best to create a new package in monorepo for shared types and validation
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

export interface JobHandle {
  id: string;
  name: string;
  description?: string;
  kind: JobKind;
  enabled: boolean;
  adminTriggerable: boolean;
  userTriggerable: boolean;
  inputSchema?: any; // JSONSchema type
  schedule?: string;
  scheduleOverride?: string | null;
  effectiveSchedule?: string;
  lastRun?: JobRunSummary;
  nextRun?: string;
}
