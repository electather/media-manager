import type { NotificationEvent, NotificationMessage } from "@nama/shared/notifications";

// Nth fail uses BACKOFF_INTERVALS_MS[N - 1] (clamped to last entry); pluginError's
// retryAfterMs overrides. Pure-policy module for testability without db/env/runtime.
export const BACKOFF_INTERVALS_MS: readonly number[] = [
  60_000, 300_000, 1_800_000, 7_200_000, 43_200_000,
];

// Upper bound on plugin-supplied retryAfterMs — prevents a buggy or malicious
// plugin from pushing nextAttemptAt arbitrarily far into the future.
const MAX_PLUGIN_RETRY_AFTER_MS = 24 * 60 * 60_000; // 24 h

/** Hard cap on attempts (initial + retries). Sized so every entry in
 *  `BACKOFF_INTERVALS_MS` can be used: 1 initial + 5 retries = 6 attempts. */
export const MAX_ATTEMPTS = 6;

/** Plugins that the host trusts with extended deliver args (`deliveryId` and
 *  `recipientUserId`) and with the host-privileged `ctx.inbox` capability.
 *  Third-party plugins receive only the SDK-typed `{ message, event,
 *  channelConfig }` shape so they cannot persist server-owned state. */
const HOST_PRIVILEGED_PLUGIN_IDS: ReadonlySet<string> = new Set(["inbox"]);

export function isHostPrivilegedPlugin(pluginId: string): boolean {
  return HOST_PRIVILEGED_PLUGIN_IDS.has(pluginId);
}

export interface DeliverBaseArgs<TConfig = unknown> {
  message: NotificationMessage;
  event: NotificationEvent;
  channelConfig: TConfig;
}

export interface DeliverHostPrivilegedArgs<TConfig = unknown> extends DeliverBaseArgs<TConfig> {
  deliveryId: string;
  recipientUserId: string;
}

// Third-party plugins see only SDK shape; host-privileged plugins additionally
// get deliveryId + recipientUserId so inbox persists row tied to the user.
export function buildDeliverArgs<TConfig = unknown>(
  pluginId: string,
  base: DeliverBaseArgs<TConfig>,
  host: { deliveryId: string; recipientUserId: string },
): DeliverBaseArgs<TConfig> | DeliverHostPrivilegedArgs<TConfig> {
  if (isHostPrivilegedPlugin(pluginId)) {
    return { ...base, deliveryId: host.deliveryId, recipientUserId: host.recipientUserId };
  }
  return base;
}

interface DeliveryFailureSignals {
  retryable?: boolean;
  retryAfterMs?: number;
  code?: string;
}

// fallow-ignore-next-line complexity
export function readFailureSignals(error: unknown): DeliveryFailureSignals {
  if (typeof error !== "object" || error === null) return {};
  const e = error as DeliveryFailureSignals & { name?: string };
  return {
    retryable: typeof e.retryable === "boolean" ? e.retryable : undefined,
    retryAfterMs: typeof e.retryAfterMs === "number" ? e.retryAfterMs : undefined,
    code: typeof e.code === "string" ? e.code : undefined,
  };
}

export function pickRetryDelayMs(nextAttemptCount: number, retryAfterMs?: number): number {
  if (typeof retryAfterMs === "number" && retryAfterMs >= 0)
    return Math.min(retryAfterMs, MAX_PLUGIN_RETRY_AFTER_MS);
  const idx = Math.min(Math.max(nextAttemptCount - 1, 0), BACKOFF_INTERVALS_MS.length - 1);
  return BACKOFF_INTERVALS_MS[idx]!;
}

/**
 * Pure decision the failure handler turns into a single repo write. Splitting
 * the policy from the IO keeps the backoff/cap logic testable without an
 * in-memory database.
 */
export type FailureDecision =
  | { action: "fail"; errorCode: string; errorMessage: string }
  | { action: "reschedule"; delayMs: number; errorCode: string; errorMessage: string };

// fallow-ignore-next-line complexity
export function decideFailure(delivery: { attemptCount: number }, error: unknown): FailureDecision {
  const signals = readFailureSignals(error);
  const errorCode = signals.code ?? "unknown_error";
  const errorMessage = error instanceof Error ? error.message : String(error);

  const nextAttemptCount = delivery.attemptCount + 1;

  // A plain error without an explicit `retryable` flag is treated as
  // retryable for the first attempt only — mirrors the design's defensive
  // default while letting plugin authors opt in to multi-attempt retries.
  const retryable =
    typeof signals.retryable === "boolean" ? signals.retryable : delivery.attemptCount < 1;

  if (!retryable || nextAttemptCount >= MAX_ATTEMPTS) {
    return { action: "fail", errorCode, errorMessage };
  }
  return {
    action: "reschedule",
    delayMs: pickRetryDelayMs(nextAttemptCount, signals.retryAfterMs),
    errorCode,
    errorMessage,
  };
}
