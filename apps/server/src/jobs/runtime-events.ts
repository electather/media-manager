import { z } from "zod";
import type { EventName } from "./events";

/**
 * Events the job runner emits after every triggered run finishes. They live in
 * `jobs/` (infra) because the runner is infra; consumers (notifications) import
 * the constants and schemas directly — `jobs/` does not expose a module barrel.
 */
export const JOB_EVENTS = {
  RUN_FAILED: "jobs.run.failed" as EventName,
  SYNC_SUCCEEDED: "jobs.sync.succeeded" as EventName,
} as const;

/**
 * Dispatcher job ids from `jobs/on.ts`. `runner.emitJobOutcome` skips outcome
 * emission for jobs in this set to prevent cascading `jobs.run.failed` chains.
 * **Invariant**: every `JOB_EVENTS` value MUST appear here (pinned by boot.test.ts CI).
 */
export const EVENT_DISPATCHER_JOB_IDS: ReadonlySet<string> = new Set<string>([
  JOB_EVENTS.RUN_FAILED as string,
  JOB_EVENTS.SYNC_SUCCEEDED as string,
]);

export const jobRunFailedPayload = z.object({
  jobId: z.string(),
  runId: z.string(),
  status: z.string(),
  error: z.string().nullable(),
});
export type JobRunFailedPayload = z.infer<typeof jobRunFailedPayload>;

export const jobSyncSucceededPayload = z.object({
  jobId: z.string(),
  runId: z.string(),
  connectionId: z.string(),
  pluginId: z.string(),
  itemCount: z.number(),
  triggeredByUserId: z.string(),
});
export type JobSyncSucceededPayload = z.infer<typeof jobSyncSucceededPayload>;
