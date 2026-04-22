import { and, asc, desc, eq, notInArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { jobRuns } from "../db/schema/jobs";
import type { JobRunStatus, JobRunSummary, JobTriggeredBy } from "@ent-mcp/shared/jobs";

const RESULT_MAX_BYTES = 4096;
const SUCCESS_RETENTION_PER_JOB = 50;
const NON_SUCCESS_STATUSES: JobRunStatus[] = [
  "partial_failure",
  "failed",
  "skipped",
  "timed_out",
  "cancelled",
];

interface StartRunInput {
  id: string;
  jobId: string;
  scopeKey?: string | null;
  triggeredBy: JobTriggeredBy;
  triggeredByUserId?: string | null;
  requestId: string;
  startedAt: number;
  coalescedCount?: number | null;
}

interface FinishRunInput {
  id: string;
  jobId: string;
  status: JobRunStatus;
  finishedAt: number;
  durationMs: number;
  errorRecordId?: string | null;
  result?: unknown;
  logs?: string | null;
  logsTruncated?: number | null;
  rowsTotal?: number | null;
  rowsSucceeded?: number | null;
  rowsFailed?: number | null;
}

/** Inserts an in-progress row. Used by all kinds at the start of a run. */
export async function startRun(input: StartRunInput): Promise<void> {
  await getDb()
    .insert(jobRuns)
    .values({
      id: input.id,
      jobId: input.jobId,
      scopeKey: input.scopeKey ?? null,
      status: "running",
      triggeredBy: input.triggeredBy,
      triggeredByUserId: input.triggeredByUserId ?? null,
      startedAt: input.startedAt,
      finishedAt: null,
      durationMs: null,
      requestId: input.requestId,
      rowsTotal: null,
      rowsSucceeded: null,
      rowsFailed: null,
      errorRecordId: null,
      result: null,
      coalescedCount: input.coalescedCount ?? null,
    });
}

/** Updates an in-progress row to its final state and prunes on success. */
export async function finishRun(input: FinishRunInput): Promise<void> {
  await getDb()
    .update(jobRuns)
    .set({
      status: input.status,
      finishedAt: input.finishedAt,
      durationMs: input.durationMs,
      errorRecordId: input.errorRecordId ?? null,
      result: serializeResult(input.result),
      logs: input.logs ?? null,
      logsTruncated: input.logsTruncated ?? 0,
      rowsTotal: input.rowsTotal ?? null,
      rowsSucceeded: input.rowsSucceeded ?? null,
      rowsFailed: input.rowsFailed ?? null,
    })
    .where(eq(jobRuns.id, input.id));
  if (input.status === "succeeded") {
    await pruneSuccessfulRuns(input.jobId);
  }
}

/** Writes a "skipped" record for a tick that could not run because a prior run was active. */
export async function recordSkipped(args: {
  id: string;
  jobId: string;
  scopeKey?: string | null;
  triggeredBy: JobTriggeredBy;
  requestId: string;
  tickAt: number;
}): Promise<void> {
  await getDb()
    .insert(jobRuns)
    .values({
      id: args.id,
      jobId: args.jobId,
      scopeKey: args.scopeKey ?? null,
      status: "skipped",
      triggeredBy: args.triggeredBy,
      triggeredByUserId: null,
      startedAt: args.tickAt,
      finishedAt: args.tickAt,
      durationMs: 0,
      requestId: args.requestId,
      rowsTotal: null,
      rowsSucceeded: null,
      rowsFailed: null,
      errorRecordId: null,
      result: null,
      coalescedCount: null,
    });
}

/** Deletes the oldest successful rows for a job beyond the retention cap. */
export async function pruneSuccessfulRuns(jobId: string): Promise<number> {
  if (!jobId) return 0;
  const db = getDb();
  const keep = await db
    .select({ id: jobRuns.id })
    .from(jobRuns)
    .where(and(eq(jobRuns.jobId, jobId), eq(jobRuns.status, "succeeded")))
    .orderBy(desc(jobRuns.startedAt))
    .limit(SUCCESS_RETENTION_PER_JOB)
    .all();
  const keepIds = keep.map((r) => r.id);
  const deleted = await db
    .delete(jobRuns)
    .where(
      and(
        eq(jobRuns.jobId, jobId),
        eq(jobRuns.status, "succeeded"),
        keepIds.length > 0 ? notInArray(jobRuns.id, keepIds) : undefined,
      ),
    )
    .returning({ id: jobRuns.id });
  return deleted.length;
}

/** Returns the most recent run for a job, optionally filtered to a scope key. */
export async function latestRun(jobId: string, scopeKey?: string): Promise<JobRunSummary | null> {
  const filters = [eq(jobRuns.jobId, jobId)];
  if (scopeKey !== undefined) filters.push(eq(jobRuns.scopeKey, scopeKey));
  const row = await getDb()
    .select()
    .from(jobRuns)
    .where(and(...filters))
    .orderBy(desc(jobRuns.startedAt))
    .limit(1)
    .get();
  return row ? toSummary(row) : null;
}

/** Returns recent runs for a job ordered newest-first. */
export async function recentRuns(jobId: string, limit: number): Promise<JobRunSummary[]> {
  const rows = await getDb()
    .select()
    .from(jobRuns)
    .where(eq(jobRuns.jobId, jobId))
    .orderBy(desc(jobRuns.startedAt))
    .limit(limit)
    .all();
  return rows.map(toSummary);
}

/** Returns recent runs with optional scopeKey and status filters. */
export async function recentRunsFiltered(
  jobId: string,
  limit: number,
  scopeKey?: string,
  status?: string,
): Promise<JobRunSummary[]> {
  const filters = [eq(jobRuns.jobId, jobId)];
  if (scopeKey !== undefined) filters.push(eq(jobRuns.scopeKey, scopeKey));
  if (status !== undefined) filters.push(eq(jobRuns.status, status as JobRunStatus));
  const rows = await getDb()
    .select()
    .from(jobRuns)
    .where(and(...filters))
    .orderBy(desc(jobRuns.startedAt))
    .limit(limit)
    .all();
  return rows.map(toSummary);
}

/** Returns a single run by id, including logs. */
export async function getRunDetail(runId: string): Promise<JobRunSummary | null> {
  const row = await getDb().select().from(jobRuns).where(eq(jobRuns.id, runId)).get();
  return row ? toSummary(row) : null;
}

/**
 * Marks every row still in `running` state as `failed`. Called once at server
 * startup to clean up records that were never finished because the previous
 * process was killed or restarted mid-run.
 */
export async function markOrphanedRunsFailed(now: number = Date.now()): Promise<number> {
  const result = await getDb()
    .update(jobRuns)
    .set({ status: "failed", finishedAt: now, durationMs: null })
    .where(eq(jobRuns.status, "running"))
    .returning({ id: jobRuns.id });
  return result.length;
}

/** Returns whether any run for (jobId, scopeKey) is currently in `running` state. */
export async function hasRunningRow(jobId: string, scopeKey: string | null): Promise<boolean> {
  const filters = [eq(jobRuns.jobId, jobId), eq(jobRuns.status, "running")];
  const row = await getDb()
    .select({ id: jobRuns.id })
    .from(jobRuns)
    .where(and(...filters, scopeKey !== null ? eq(jobRuns.scopeKey, scopeKey) : undefined))
    .orderBy(asc(jobRuns.startedAt))
    .get();
  return Boolean(row);
}

/** Returns true if the given status is a non-success status (retained indefinitely). */
export function isRetainedFailure(status: JobRunStatus): boolean {
  return NON_SUCCESS_STATUSES.includes(status);
}

function serializeResult(result: unknown): string | null {
  if (result === undefined || result === null) return null;
  let text: string;
  try {
    text = JSON.stringify(result);
  } catch {
    return null;
  }
  if (text.length <= RESULT_MAX_BYTES) return text;
  return text.slice(0, RESULT_MAX_BYTES);
}

function toSummary(row: typeof jobRuns.$inferSelect): JobRunSummary {
  return {
    id: row.id,
    jobId: row.jobId,
    scopeKey: row.scopeKey,
    status: row.status,
    triggeredBy: row.triggeredBy,
    triggeredByUserId: row.triggeredByUserId,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    durationMs: row.durationMs,
    requestId: row.requestId,
    rowsTotal: row.rowsTotal,
    rowsSucceeded: row.rowsSucceeded,
    rowsFailed: row.rowsFailed,
    errorRecordId: row.errorRecordId,
    result: row.result,
    logs: row.logs ?? null,
    logsTruncated: row.logsTruncated ?? 0,
    coalescedCount: row.coalescedCount,
  };
}

/** Used by tests to keep retention decisions expressive. */
export const retention = {
  successPerJob: SUCCESS_RETENTION_PER_JOB,
  resultMaxBytes: RESULT_MAX_BYTES,
};
