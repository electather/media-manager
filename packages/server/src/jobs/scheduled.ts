import { consola } from "consola";
import { newRequestId } from "../errors/request-context";
import { assertValidSchedule, nextFireTime, scheduleCron, unscheduleCron } from "./croner-adapter";
import { getConfig, effectiveSchedule } from "./config";
import { recordSkipped } from "./history";
import { register, type RegistryEntry } from "./registry";
import { isRunning, run } from "./runner";
import type { CaptureMeta, JobHandle, JobRunContext } from "./types";

export interface RegisterScheduledOptions {
  id: string;
  schedule: string;
  handler: (ctx: JobRunContext) => Promise<void>;
  timeoutSec?: number;
  capture?: CaptureMeta;
}

export function registerScheduled(opts: RegisterScheduledOptions): JobHandle {
  assertValidSchedule(opts.schedule);

  const entry: RegistryEntry = {
    id: opts.id,
    kind: "scheduled",
    schedule: opts.schedule,
    capture: opts.capture,
    dispose() {
      unscheduleCron(opts.id);
    },
    onScheduleChange(schedule) {
      scheduleCron(opts.id, schedule, () => void onTick(schedule));
    },
    onEnabledChange(enabled) {
      if (enabled) {
        void scheduleFromConfig();
      } else {
        unscheduleCron(opts.id);
      }
    },
  };
  register(entry);

  async function onTick(_schedule: string): Promise<void> {
    const cfg = await getConfig(opts.id);
    if (!cfg.enabled) return;
    if (isRunning(opts.id)) {
      await recordSkipped({
        id: crypto.randomUUID(),
        jobId: opts.id,
        triggeredBy: "cron",
        requestId: newRequestId(),
        tickAt: Date.now(),
      });
      return;
    }
    await run({
      jobId: opts.id,
      kind: "scheduled",
      triggeredBy: "cron",
      timeoutSec: opts.timeoutSec,
      capture: opts.capture,
      handler: opts.handler,
    });
  }

  async function scheduleFromConfig(): Promise<void> {
    const cfg = await getConfig(opts.id);
    if (!cfg.enabled) {
      unscheduleCron(opts.id);
      return;
    }
    const schedule = effectiveSchedule(opts.schedule, cfg.scheduleOverride);
    if (!schedule) return;
    try {
      assertValidSchedule(schedule);
    } catch (err) {
      consola.warn(
        `[job:${opts.id}] invalid schedule override, falling back: ${err instanceof Error ? err.message : String(err)}`,
      );
      scheduleCron(opts.id, opts.schedule, () => void onTick(opts.schedule));
      return;
    }
    scheduleCron(opts.id, schedule, () => void onTick(schedule));
  }

  void scheduleFromConfig();

  return {
    id: opts.id,
    kind: "scheduled",
    enabled: true,
    schedule: opts.schedule,
    nextRun: nextFireTime(opts.id) ?? undefined,
  };
}
