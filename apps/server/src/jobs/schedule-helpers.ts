import { consola } from "consola";
import { assertValidSchedule, nextFireTime, scheduleCron, unscheduleCron } from "./croner-adapter";
import { effectiveSchedule, getConfig } from "./config";
import type { JobHandle, JobKind } from "@ent-mcp/shared/jobs";

interface BaseJobOpts {
  id: string;
  name: string;
  description?: string;
  schedule: string;
}

export async function scheduleJobFromConfig(
  jobId: string,
  defaultSchedule: string,
  onTick: () => void,
): Promise<void> {
  const cfg = await getConfig(jobId);
  if (!cfg.enabled) {
    unscheduleCron(jobId);
    return;
  }
  const schedule = effectiveSchedule(defaultSchedule, cfg.scheduleOverride);
  if (!schedule) return;
  try {
    assertValidSchedule(schedule);
  } catch (err) {
    consola.warn(
      `[job:${jobId}] invalid schedule override, falling back: ${err instanceof Error ? err.message : String(err)}`,
    );
    scheduleCron(jobId, defaultSchedule, onTick);
    return;
  }
  scheduleCron(jobId, schedule, onTick);
}

export function buildJobHandle(
  opts: BaseJobOpts,
  kind: JobKind,
  adminTriggerable: boolean,
): JobHandle {
  return {
    id: opts.id,
    name: opts.name,
    description: opts.description,
    kind,
    enabled: true,
    adminTriggerable,
    userTriggerable: false,
    schedule: opts.schedule,
    nextRun: nextFireTime(opts.id) ?? undefined,
  };
}
