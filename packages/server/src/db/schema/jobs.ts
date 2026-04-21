import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { user } from "./auth";
import { errorRecords } from "./errors";

const logLevelEnum = ["debug", "info", "warn", "error"] as const;

const runStatusEnum = [
  "running",
  "succeeded",
  "partial_failure",
  "failed",
  "skipped",
  "timed_out",
  "cancelled",
] as const;

const triggeredByEnum = ["cron", "admin", "user", "feature"] as const;

/**
 * One row per attempted job run, including skips, timeouts, and cancellations.
 * Retention: last 50 successful rows per job; all non-success rows kept indefinitely.
 */
export const jobRuns = sqliteTable(
  "job_runs",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id").notNull(),
    scopeKey: text("scope_key"),
    status: text("status", { enum: runStatusEnum }).notNull(),
    triggeredBy: text("triggered_by", { enum: triggeredByEnum }).notNull(),
    triggeredByUserId: text("triggered_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
    durationMs: integer("duration_ms"),
    requestId: text("request_id").notNull(),
    rowsTotal: integer("rows_total"),
    rowsSucceeded: integer("rows_succeeded"),
    rowsFailed: integer("rows_failed"),
    errorRecordId: text("error_record_id").references(() => errorRecords.id, {
      onDelete: "set null",
    }),
    result: text("result"),
    logs: text("logs"),
    logsTruncated: integer("logs_truncated").default(0),
    coalescedCount: integer("coalesced_count"),
  },
  (table) => [
    index("job_runs_job_started_idx").on(table.jobId, table.startedAt),
    index("job_runs_started_idx").on(table.startedAt),
    index("job_runs_status_started_idx").on(table.status, table.startedAt),
    index("job_runs_request_idx").on(table.requestId),
    index("job_runs_scope_key_idx").on(table.scopeKey),
  ],
);

/** Per-job operator overrides. Absent row means "enabled, use code-declared schedule". */
export const jobConfig = sqliteTable("job_config", {
  jobId: text("job_id").primaryKey(),
  enabled: integer("enabled").notNull().default(1),
  scheduleOverride: text("schedule_override"),
  logLevel: text("log_level", { enum: logLevelEnum }).notNull().default("info"),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  updatedAt: integer("updated_at").notNull(),
});

export const insertJobRunSchema = createInsertSchema(jobRuns);
export const selectJobRunSchema = createSelectSchema(jobRuns);
export const insertJobConfigSchema = createInsertSchema(jobConfig);
export const selectJobConfigSchema = createSelectSchema(jobConfig);

export type JobRunStatus = (typeof runStatusEnum)[number];
export type JobTriggeredBy = (typeof triggeredByEnum)[number];
export type LogLevel = (typeof logLevelEnum)[number];
