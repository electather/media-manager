import { z } from "zod";
import { JOB_RUN_STATUSES, JOB_TRIGGERED_BY, LOG_LEVELS } from "./enums";

export const jobRunStatusSchema = z.enum(JOB_RUN_STATUSES);
export const jobTriggeredBySchema = z.enum(JOB_TRIGGERED_BY);
export const logLevelSchema = z.enum(LOG_LEVELS);

/** Body accepted by `POST /admin/jobs/:id/trigger` — jobs accept arbitrary input. */
export const triggerBodySchema = z.unknown().optional();

/** Body accepted by `POST /admin/jobs/:id/config`. */
export const jobConfigBodySchema = z.object({
  enabled: z.boolean().optional(),
  scheduleOverride: z.string().nullable().optional(),
  logLevel: logLevelSchema.optional(),
});
export type JobConfigBody = z.infer<typeof jobConfigBodySchema>;

/** Query for listing job runs under `GET /admin/jobs/:id/runs`. */
export const jobRunsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
  scopeKey: z.string().optional(),
  status: z.string().optional(),
});
export type JobRunsQuery = z.infer<typeof jobRunsQuerySchema>;

/** Body for `POST /admin/jobs/:id/cancel`. */
export const jobCancelBodySchema = z.object({ scopeKey: z.string().optional() }).optional();
