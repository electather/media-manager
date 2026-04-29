import { eq } from "drizzle-orm";
import type { LogLevel } from "@ent-mcp/shared/jobs";
import { getDb } from "../db/client";
import { jobConfig } from "../db/schema/jobs";

export interface JobConfigRow {
  jobId: string;
  enabled: boolean;
  scheduleOverride: string | null;
  logLevel: LogLevel;
}

/** Returns the row for a job, or a synthesized defaults row when none exists. */
export async function getConfig(jobId: string): Promise<JobConfigRow> {
  const row = await getDb().select().from(jobConfig).where(eq(jobConfig.jobId, jobId)).get();
  if (!row) return { jobId, enabled: true, scheduleOverride: null, logLevel: "info" };
  return {
    jobId: row.jobId,
    enabled: row.enabled === 1,
    scheduleOverride: row.scheduleOverride,
    logLevel: (row.logLevel as LogLevel) ?? "info",
  };
}

export interface UpdateInput {
  enabled?: boolean;
  scheduleOverride?: string | null;
  logLevel?: LogLevel;
  updatedBy?: string;
}

/** Creates or updates the config row. Only the provided fields are touched. */
// fallow-ignore-next-line complexity
export async function updateConfig(jobId: string, input: UpdateInput): Promise<JobConfigRow> {
  const db = getDb();
  const now = Date.now();
  const existing = await getConfig(jobId);
  const next = {
    enabled: input.enabled ?? existing.enabled,
    scheduleOverride:
      input.scheduleOverride === undefined ? existing.scheduleOverride : input.scheduleOverride,
    logLevel: input.logLevel ?? existing.logLevel,
  };
  await db
    .insert(jobConfig)
    .values({
      jobId,
      enabled: next.enabled ? 1 : 0,
      scheduleOverride: next.scheduleOverride,
      logLevel: next.logLevel,
      updatedBy: input.updatedBy ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: jobConfig.jobId,
      set: {
        enabled: next.enabled ? 1 : 0,
        scheduleOverride: next.scheduleOverride,
        logLevel: next.logLevel,
        updatedBy: input.updatedBy ?? null,
        updatedAt: now,
      },
    });
  return { jobId, ...next };
}

/** Resolves the schedule actually in effect — override wins, declared schedule is the fallback. */
export function effectiveSchedule(
  declared: string | undefined,
  override: string | null,
): string | undefined {
  return override && override.length > 0 ? override : declared;
}
