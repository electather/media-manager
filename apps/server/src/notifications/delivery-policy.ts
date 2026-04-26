import type { NotificationEvent, NotificationMessage } from "@ent-mcp/shared/notifications";

/**
 * Backoff schedule used when a retryable delivery attempt fails. The Nth fail
 * picks `BACKOFF_INTERVALS_MS[N - 1]` (clamped to the last entry); a
 * `retryAfterMs` carried on the thrown `pluginError` overrides the chosen
 * interval. Lives in this pure-policy module so backoff/cap behavior is
 * testable without a database, env, or plugin runtime.
 */
export const BACKOFF_INTERVALS_MS: readonly number[] = [
  60_000, 300_000, 1_800_000, 7_200_000, 43_200_000,
];

/** Hard cap on attempts (initial + retries). Sized so every entry in
 *  `BACKOFF_INTERVALS_MS` can be used: 1 initial + 5 retries = 6 attempts,
 *  the last reschedule lands on the 12h delay before the cap fires on the
 *  sixth failure. The cap is applied after the failed attempt is counted,
 *  so a delivery may run up to MAX_ATTEMPTS times before we mark it
 *  terminally failed. */
export const MAX_ATTEMPTS = 6;

/** The plugins that the host trusts with extended deliver args (`deliveryId`
 *  and `recipientUserId`) and with the host-privileged `ctx.inbox` capability.
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

/**
 * Builds the arg bag passed to a plugin's `deliver()`. Third-party plugins
 * see only `{ message, event, channelConfig }` (the SDK-typed shape); host-
 * privileged plugins additionally receive the host-owned `deliveryId` and
 * `recipientUserId` so the inbox can persist a row tied to the right user.
 */
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
  if (typeof retryAfterMs === "number" && retryAfterMs >= 0) return retryAfterMs;
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

export function decideFailure(delivery: { attemptCount: number }, error: unknown): FailureDecision {
  const signals = readFailureSignals(error);
  const errorCode = signals.code ?? "unknown_error";
  const errorMessage = error instanceof Error ? error.message : String(error);

  // attemptCount is the number of attempts already counted before this one;
  // the attempt that just failed becomes attempt N = attemptCount + 1.
  const nextAttemptCount = delivery.attemptCount + 1;

  // A plain error without an explicit `retryable` flag is treated as
  // retryable for the first attempt only — that mirrors the design's
  // "defensive default" while still letting plugin authors opt in to
  // multi-attempt retries by setting the flag.
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
