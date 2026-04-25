import { getConfig } from "./config";
import { register, type RegistryEntry } from "./registry";
import { requestCancel, run } from "./runner";
import type { CaptureMeta, CoalescedJobHandle, JobRunContext } from "./types";

const DEFAULT_MAX_WAIT_MS = 60_000;

export interface RegisterCoalescedOptions {
  id: string;
  name: string;
  description?: string;
  debounceMs: number;
  maxWaitMs?: number;
  scopeKey: (input: unknown) => string;
  handler: (ctx: JobRunContext, triggerCount: number, scopeKey: string) => Promise<void>;
  timeoutSec?: number;
  capture?: CaptureMeta;
}

interface PendingBurst {
  timer: ReturnType<typeof setTimeout>;
  maxWaitTimer: ReturnType<typeof setTimeout>;
  triggerCount: number;
  firstTriggerRequestId?: string;
  flushing: Promise<void> | null;
}

export function registerCoalesced(opts: RegisterCoalescedOptions): CoalescedJobHandle {
  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const pending = new Map<string, PendingBurst>();

  const entry: RegistryEntry = {
    id: opts.id,
    name: opts.name,
    description: opts.description,
    kind: "coalesced",
    capture: opts.capture,
    dispose() {
      for (const burst of pending.values()) {
        clearTimeout(burst.timer);
        clearTimeout(burst.maxWaitTimer);
      }
      pending.clear();
    },
    cancel: (scopeKey) => requestCancel(opts.id, scopeKey),
  };
  register(entry);

  function trigger(input: { scopeKey: string } & Record<string, unknown>): void {
    const scopeKey = opts.scopeKey(input);
    const existing = pending.get(scopeKey);
    if (existing) {
      existing.triggerCount += 1;
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => void flush(scopeKey), opts.debounceMs);
      return;
    }
    const burst: PendingBurst = {
      timer: setTimeout(() => void flush(scopeKey), opts.debounceMs),
      maxWaitTimer: setTimeout(() => void flush(scopeKey), maxWaitMs),
      triggerCount: 1,
      firstTriggerRequestId: typeof input.requestId === "string" ? input.requestId : undefined,
      flushing: null,
    };
    pending.set(scopeKey, burst);
  }

  async function flush(scopeKey: string): Promise<void> {
    const burst = pending.get(scopeKey);
    if (!burst) return;
    if (burst.flushing) return;
    clearTimeout(burst.timer);
    clearTimeout(burst.maxWaitTimer);

    const cfg = await getConfig(opts.id);
    if (!cfg.enabled) {
      pending.delete(scopeKey);
      return;
    }

    const snapshot = { triggerCount: burst.triggerCount, requestId: burst.firstTriggerRequestId };
    burst.triggerCount = 0;
    burst.firstTriggerRequestId = undefined;

    const flushing = run({
      jobId: opts.id,
      kind: "coalesced",
      scopeKey,
      triggeredBy: "feature",
      requestId: snapshot.requestId,
      timeoutSec: opts.timeoutSec,
      capture: opts.capture,
      coalescedCount: snapshot.triggerCount,
      handler: (ctx) => opts.handler(ctx, snapshot.triggerCount, scopeKey),
    });
    burst.flushing = flushing.then(() => undefined);
    try {
      await burst.flushing;
    } finally {
      const postRun = pending.get(scopeKey);
      if (postRun && postRun.triggerCount === 0) {
        pending.delete(scopeKey);
      } else if (postRun) {
        postRun.flushing = null;
        postRun.timer = setTimeout(() => void flush(scopeKey), opts.debounceMs);
        postRun.maxWaitTimer = setTimeout(() => void flush(scopeKey), maxWaitMs);
      }
    }
  }

  return {
    id: opts.id,
    name: opts.name,
    description: opts.description,
    kind: "coalesced",
    enabled: true,
    adminTriggerable: false,
    userTriggerable: false,
    trigger,
  };
}
