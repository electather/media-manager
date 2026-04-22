import { consola } from "consola";
import { newRequestId } from "../errors/request-context";
import { assertValidSchedule, nextFireTime, scheduleCron, unscheduleCron } from "./croner-adapter";
import { getConfig, effectiveSchedule } from "./config";
import { recordSkipped } from "./history";
import { register, type RegistryEntry } from "./registry";
import { isRunning, run } from "./runner";
import type { JobHandle } from "@ent-mcp/shared/jobs";
import type { CaptureMeta, JobRunContext } from "./types";

export interface RegisterScheduledOptions {
  id: string;
  name: string;
  description?: string;
  schedule: string;
  handler: (ctx: JobRunContext) => Promise<void>;
  timeoutSec?: number;
  adminTriggerable?: boolean;
  capture?: CaptureMeta;
}

export function registerScheduled(opts: RegisterScheduledOptions): JobHandle {
  assertValidSchedule(opts.schedule);

  const adminTriggerable = opts.adminTriggerable ?? false;

  const entry: RegistryEntry = {
    id: opts.id,
    name: opts.name,
    description: opts.description,
    kind: "scheduled",
    schedule: opts.schedule,
    capture: opts.capture,
    dispose() {
      unscheduleCron(opts.id);
    },
    triggerFromApi: adminTriggerable
      ? async (_input, source) => {
          if (isRunning(opts.id)) {
            const { jobErrors } = await import("./errors");
            throw jobErrors.alreadyRunning(opts.id);
          }
          const outcome = await run({
            jobId: opts.id,
            kind: "scheduled",
            triggeredBy: source.triggeredBy,
            triggeredByUserId: source.triggeredByUserId ?? null,
            requestId: source.requestId,
            timeoutSec: opts.timeoutSec,
            capture: opts.capture,
            handler: opts.handler,
          });
          return { runId: outcome.runId, result: undefined };
        }
      : undefined,
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
    name: opts.name,
    description: opts.description,
    kind: "scheduled",
    enabled: true,
    adminTriggerable,
    userTriggerable: false,
    schedule: opts.schedule,
    nextRun: nextFireTime(opts.id) ?? undefined,
  };
}
