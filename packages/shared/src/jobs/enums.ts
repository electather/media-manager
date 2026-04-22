/**
 * Job domain enum constants. Exported as `as const` tuples so Drizzle's
 * `text("x", { enum: ... })` and Zod's `z.enum(...)` both accept them and
 * derive identical string-literal types.
 */

export const JOB_RUN_STATUSES = [
  "running",
  "succeeded",
  "partial_failure",
  "failed",
  "skipped",
  "timed_out",
  "cancelled",
] as const;

export const JOB_TRIGGERED_BY = ["cron", "admin", "user", "feature"] as const;

export const JOB_KINDS = ["scheduled", "scheduled_per_row", "triggerable", "coalesced"] as const;

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export type JobRunStatus = (typeof JOB_RUN_STATUSES)[number];
export type JobTriggeredBy = (typeof JOB_TRIGGERED_BY)[number];
export type JobKind = (typeof JOB_KINDS)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];
