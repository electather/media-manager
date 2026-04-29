import { consola } from "consola";
import { assertValidSchedule, nextFireTime, scheduleCron, unscheduleCron } from "./croner-adapter";
import { effectiveSchedule, getConfig } from "./config";
import { isRunning } from "./runner";
import type { JobHandle, JobKind } from "@ent-mcp/shared/jobs";

interface BaseJobOpts {
  id: string;
  name: string;
  description?: string;
  schedule: string;
}

interface ScheduledCallbackOpts {
  id: string;
  schedule: string;
}

export function buildScheduledCallbacks(opts: ScheduledCallbackOpts, onTick: () => void) {
  return {
    dispose() {
      unscheduleCron(opts.id);
    },
    onScheduleChange(schedule: string) {
      scheduleCron(opts.id, schedule, () => onTick());
    },
    onEnabledChange(enabled: boolean) {
      if (enabled) void scheduleJobFromConfig(opts.id, opts.schedule, () => onTick());
      else unscheduleCron(opts.id);
    },
  };
}

export async function assertNotRunning(jobId: string): Promise<void> {
  if (isRunning(jobId)) {
    const { jobErrors } = await import("./errors");
    throw jobErrors.alreadyRunning(jobId);
  }
}

// fallow-ignore-next-line complexity
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
