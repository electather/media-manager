import type { ConsolaInstance } from "consola";
import type { JobHandle, JobTriggeredBy } from "@ent-mcp/shared/jobs";

// ─── Server-only execution types ──────────────────────────────────────────────

export type CaptureSource = "cron" | "plugin";

export interface CaptureMeta {
  source?: CaptureSource;
  pluginId?: string;
}

/** Passed to every handler invocation. `abortSignal` is how cancel is delivered. */
export interface JobRunContext {
  runId: string;
  triggeredBy: JobTriggeredBy;
  triggeredByUserId?: string;
  scopeKey?: string;
  requestId: string;
  logger: ConsolaInstance;
  abortSignal: AbortSignal;
}

export interface TriggerableJobHandle<TInput = unknown, TResult = unknown> extends JobHandle {
  trigger(input: TInput, source: TriggerSource): Promise<{ runId: string; result: TResult }>;
}

export interface CoalescedJobHandle extends JobHandle {
  trigger(input: { scopeKey: string } & Record<string, unknown>): void;
}

export interface TriggerSource {
  triggeredBy: JobTriggeredBy;
  triggeredByUserId?: string;
  requestId?: string;
}

export type AdminOrFeaturePermission =
  | "admin:jobs"
  | {
      kind: "feature";
      check: (userId: string, input: unknown) => Promise<boolean>;
    };
