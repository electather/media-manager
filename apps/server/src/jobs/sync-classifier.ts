import type { JobKind } from "@nama/shared/jobs";

/**
 * Sync-classified job: completion surfaces as `connection.sync.succeeded`.
 * Today: `scheduled_per_row` only (per-row iteration for host preferences
 * and plugin per-connection jobs; see plugin-jobs.ts). Future kinds should opt in.
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
