import { assertValidSchedule } from "./croner-adapter";
import { register, type RegistryEntry } from "./registry";
import {
  assertNotRunning,
  buildJobHandle,
  buildScheduledCallbacks,
  scheduleJobFromConfig,
} from "./schedule-helpers";
import { run } from "./runner";
import { shouldSkipTick } from "./tick-guard";
import type { JobHandle } from "@ent-mcp/shared/jobs";
import type { JobCaptureMeta, JobRunContext } from "./types";

export interface RegisterScheduledOptions {
  id: string;
  name: string;
  description?: string;
  schedule: string;
  handler: (ctx: JobRunContext) => Promise<void>;
  timeoutSec?: number;
  adminTriggerable?: boolean;
  capture?: JobCaptureMeta;
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
    ...buildScheduledCallbacks(opts, onTick),
    triggerFromApi: adminTriggerable
      ? async (_input, source) => {
          await assertNotRunning(opts.id);
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
  };
  register(entry);

  async function onTick(): Promise<void> {
    if (await shouldSkipTick(opts.id)) return;
    await run({
      jobId: opts.id,
      kind: "scheduled",
      triggeredBy: "cron",
      timeoutSec: opts.timeoutSec,
      capture: opts.capture,
      handler: opts.handler,
    });
  }

  void scheduleJobFromConfig(opts.id, opts.schedule, () => void onTick());

  return buildJobHandle(opts, "scheduled", adminTriggerable);
}
