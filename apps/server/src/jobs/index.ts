import type { JobHandle } from "@ent-mcp/shared/jobs";
import { assertValidSchedule, nextFireTime, unscheduleAll } from "./croner-adapter";
import { effectiveSchedule, getConfig, updateConfig, type UpdateInput } from "./config";
import { latestRun } from "./history";
import * as registry from "./registry";

export { registerScheduled } from "./scheduled";
export { registerScheduledPerRow } from "./scheduled-per-row";
export { registerTriggerable } from "./triggerable";
export { registerCoalesced } from "./coalesced";
export type { TriggerableJobHandle, CoalescedJobHandle, JobRunContext } from "./types";
export { jobErrors } from "./errors";
export { recentRuns, recentRunsFiltered, getRunDetail } from "./history";

/** Removes a registered job. Cron entry is stopped; in-flight runs finish naturally. */
export function unregister(jobId: string): void {
  registry.unregister(jobId);
}

/** Returns the registered entry for a job id, or undefined. */
export function find(jobId: string) {
  return registry.find(jobId);
}

/** Returns an up-to-date JobHandle for each registered job. */
export async function list(): Promise<JobHandle[]> {
  const entries = registry.list();
  const handles: JobHandle[] = [];
  for (const entry of entries) {
    handles.push(await toHandle(entry));
  }
  return handles;
}

/** Returns an up-to-date JobHandle for one job, or null if unregistered. */
export async function describe(jobId: string): Promise<JobHandle | null> {
  const entry = registry.find(jobId);
  if (!entry) return null;
  return toHandle(entry);
}

/** Applies a config change and re-schedules the underlying cron if needed. */
export async function applyConfigChange(
  jobId: string,
  input: UpdateInput,
): Promise<JobHandle | null> {
  const entry = registry.find(jobId);
  if (!entry) return null;
  if (input.scheduleOverride) assertValidSchedule(input.scheduleOverride);

  const next = await updateConfig(jobId, input);

  if (input.enabled !== undefined) entry.onEnabledChange?.(next.enabled);
  if (input.scheduleOverride !== undefined) {
    const schedule = effectiveSchedule(entry.schedule, next.scheduleOverride);
    if (schedule && next.enabled) entry.onScheduleChange?.(schedule);
  }
  return toHandle(entry);
}

/** Shuts down every registered job. Intended for process exit and tests. */
export function stopAll(): void {
  unscheduleAll();
  registry.clear();
}

async function toHandle(entry: registry.RegistryEntry): Promise<JobHandle> {
  const cfg = await getConfig(entry.id);
  const effective = effectiveSchedule(entry.schedule, cfg.scheduleOverride);
  const lastRun = await latestRun(entry.id);

  const isFeatureScoped =
    typeof entry.requiredPermission === "object" && entry.requiredPermission.kind === "feature";

  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    kind: entry.kind,
    enabled: cfg.enabled,
    adminTriggerable: entry.requiredPermission === "admin:jobs" || !!entry.triggerFromApi,
    userTriggerable: isFeatureScoped,
    inputSchema: entry.inputSchema,
    schedule: entry.schedule,
    scheduleOverride: cfg.scheduleOverride,
    effectiveSchedule: effective,
    lastRun: lastRun ?? undefined,
    nextRun: entry.schedule ? (nextFireTime(entry.id) ?? undefined) : undefined,
  };
}
