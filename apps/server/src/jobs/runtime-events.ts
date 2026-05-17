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
