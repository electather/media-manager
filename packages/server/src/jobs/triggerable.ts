import Ajv, { type ValidateFunction } from "ajv";
import { consola } from "consola";
import { newRequestId } from "../errors/request-context";
import { assertValidSchedule, nextFireTime, scheduleCron, unscheduleCron } from "./croner-adapter";
import { getConfig, effectiveSchedule } from "./config";
import { jobErrors } from "./errors";
import { recordSkipped } from "./history";
import { register, type RegistryEntry } from "./registry";
import { isRunning, requestCancel, run } from "./runner";
import type {
  AdminOrFeaturePermission,
  CaptureMeta,
  JobRunContext,
  TriggerableJobHandle,
  TriggerSource,
} from "./types";

const ajv = new Ajv({ allErrors: true, strict: false });

export interface RegisterTriggerableOptions<TInput, TResult> {
  id: string;
  schedule?: string;
  handler: (ctx: JobRunContext, input: TInput | null) => Promise<TResult>;
  scopeKey?: (input: TInput) => string;
  timeoutSec?: number;
  inputSchema?: Record<string, unknown>;
  requiredPermission: AdminOrFeaturePermission;
  capture?: CaptureMeta;
}

export function registerTriggerable<TInput = unknown, TResult = unknown>(
  opts: RegisterTriggerableOptions<TInput, TResult>,
): TriggerableJobHandle<TInput, TResult> {
  if (opts.schedule) assertValidSchedule(opts.schedule);
  const validate = opts.inputSchema ? ajv.compile(opts.inputSchema) : null;

  const entry: RegistryEntry = {
    id: opts.id,
    kind: "triggerable",
    schedule: opts.schedule,
    capture: opts.capture,
    requiredPermission: opts.requiredPermission,
    dispose() {
      unscheduleCron(opts.id);
    },
    triggerFromApi: async (input, source) => {
      const result = await trigger(input as TInput, source);
      return { runId: result.runId, result: result.result };
    },
    cancel: (scopeKey) => requestCancel(opts.id, resolveScopeKeyFromString(scopeKey)),
    onScheduleChange(schedule) {
      if (!opts.schedule) return;
      scheduleCron(opts.id, schedule, () => void onTick());
    },
    onEnabledChange(enabled) {
      if (!opts.schedule) return;
      if (enabled) void scheduleFromConfig();
      else unscheduleCron(opts.id);
    },
  };
  register(entry);

  async function trigger(
    input: TInput,
    source: TriggerSource,
  ): Promise<{ runId: string; result: TResult }> {
    assertInputValid(input, validate);
    const cfg = await getConfig(opts.id);
    if (!cfg.enabled) throw jobErrors.disabled(opts.id);

    const scopeKey = opts.scopeKey ? opts.scopeKey(input) : undefined;
    if (isRunning(opts.id, scopeKey)) throw jobErrors.alreadyRunning(opts.id, scopeKey);

    const outcome = await run({
      jobId: opts.id,
      kind: "triggerable",
      scopeKey: scopeKey ?? null,
      triggeredBy: source.triggeredBy,
      triggeredByUserId: source.triggeredByUserId ?? null,
      requestId: source.requestId,
      timeoutSec: opts.timeoutSec,
      capture: opts.capture,
      handler: (ctx) => opts.handler(ctx, input),
    });

    if (outcome.status !== "succeeded") {
      throw outcome.error instanceof Error
        ? outcome.error
        : new Error(`triggerable job ${opts.id} ended as ${outcome.status}`);
    }

    return { runId: outcome.runId, result: outcome.result as TResult };
  }

  async function onTick(): Promise<void> {
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
      kind: "triggerable",
      triggeredBy: "cron",
      timeoutSec: opts.timeoutSec,
      capture: opts.capture,
      handler: (ctx) => opts.handler(ctx, null),
    });
  }

  async function scheduleFromConfig(): Promise<void> {
    if (!opts.schedule) return;
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
      scheduleCron(opts.id, opts.schedule, () => void onTick());
      return;
    }
    scheduleCron(opts.id, schedule, () => void onTick());
  }

  if (opts.schedule) void scheduleFromConfig();

  return {
    id: opts.id,
    kind: "triggerable",
    enabled: true,
    schedule: opts.schedule,
    nextRun: opts.schedule ? (nextFireTime(opts.id) ?? undefined) : undefined,
    trigger,
  };
}

function assertInputValid(input: unknown, validate: ValidateFunction | null): void {
  if (!validate) return;
  if (validate(input)) return;
  const detail = ajv.errorsText(validate.errors);
  throw jobErrors.badInput(detail || "invalid input");
}

function resolveScopeKeyFromString(scopeKey?: string | null): string | undefined {
  return scopeKey ?? undefined;
}
