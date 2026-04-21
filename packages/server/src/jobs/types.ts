import type { ConsolaInstance } from "consola";
import type { JobRunStatus, JobTriggeredBy, LogLevel } from "../db/schema/jobs";

export type { JobRunStatus, JobTriggeredBy, LogLevel };

export type JobKind = "scheduled" | "scheduled_per_row" | "triggerable" | "coalesced";

export type CaptureSource = "cron" | "plugin";

export interface CaptureMeta {
  source?: CaptureSource;
  pluginId?: string;
}

/** Passed to every handler invocation. `abortSignal` is how cancel is delivered. */
export interface JobRunContext {
  runId: string;
  triggeredBy: JobTriggeredBy;
  triggeredByUserId?: string;
  scopeKey?: string;
  requestId: string;
  logger: ConsolaInstance;
  abortSignal: AbortSignal;
}

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
  inputSchema?: Record<string, unknown>;
  schedule?: string;
  scheduleOverride?: string | null;
  effectiveSchedule?: string;
  lastRun?: JobRunSummary;
  nextRun?: Date;
}

export interface TriggerableJobHandle<TInput = unknown, TResult = unknown> extends JobHandle {
  trigger(input: TInput, source: TriggerSource): Promise<{ runId: string; result: TResult }>;
}

export interface CoalescedJobHandle extends JobHandle {
  trigger(input: { scopeKey: string } & Record<string, unknown>): void;
}

export interface TriggerSource {
  triggeredBy: JobTriggeredBy;
  triggeredByUserId?: string;
  requestId?: string;
}

export type AdminOrFeaturePermission =
  | "admin:jobs"
  | {
      kind: "feature";
      check: (userId: string, input: unknown) => Promise<boolean>;
    };
