import type { JobKind } from "@nama/shared/jobs";

/**
 * A job is "sync-classified" when its successful completion represents a
 * connection sync that should surface as `connection.sync.succeeded`.
 *
 * Today this is `scheduled_per_row` jobs only — that kind is the per-row
 * iteration framework used by both host preference rebuilds and plugin
 * per-connection jobs (see `apps/server/src/jobs/plugin-jobs.ts`).
 *
 * Future job kinds that represent a connection sync should opt in here.
 */
export function isSyncJob(kind: JobKind): boolean {
  return kind === "scheduled_per_row";
}

/**
 * Plugin per-connection jobs are registered with id `plugin.<pluginId>.<jobId>`.
 * Returns the parsed `pluginId` when the pattern matches, otherwise `null`.
 */
export function pluginIdFromJobId(jobId: string): string | null {
  if (!jobId.startsWith("plugin.")) return null;
  const rest = jobId.slice("plugin.".length);
  const dot = rest.indexOf(".");
  if (dot === -1) return null;
  return rest.slice(0, dot);
}
