import { AllPluginsFailedError, TRANSIENT_PLUGIN_CODES } from "../errors";
import type { AggregateResult } from "../types";

/**
 * Result envelope returned by every aggregate-style helper used by the home
 * feed. `partial` mirrors the design's `partial: true` row signal.
 */
export interface HomeAggregate<T extends unknown[]> {
  items: T;
  partial: boolean;
}

/**
 * Translates a raw `AggregateResult` into the home-feed `HomeAggregate`
 * envelope and decides whether the row should be flagged `all_failed`.
 *
 * Four distinct outcomes share the surface:
 *   - `attempted === 0` — no providers installed. Returns empty, partial=false;
 *     row drops normally (no `partial: true` because there is no error to
 *     surface).
 *   - every provider errored, but ALL failures are transient
 *     (`TRANSIENT_PLUGIN_CODES`: rate-limit, upstream 5xx, timeout) — the data
 *     is temporarily unavailable, not gone. Soft-degrades to empty +
 *     `partial: true` so the row renders empty and self-heals on a later
 *     fetch, instead of hard-failing on a transient blip (e.g. a rate-limited
 *     Trakt token refresh on the `calendar@v1` "coming up" row).
 *   - every provider errored and at least one failure is terminal (auth, bad
 *     input, …) — throws `AllPluginsFailedError` so the orchestrator marks the
 *     row `all_failed` and the surface can prompt the user to act, rather than
 *     letting `upcomingForYou`'s ok_empty exemption fire on a real outage.
 *   - else — at least one provider succeeded. Returns whatever data was
 *     collected, with `partial: true` when at least one peer errored.
 */
// fallow-ignore-next-line complexity
export function interpretAggregate<T>(
  capabilityKey: string,
  result: AggregateResult<T[]>,
): HomeAggregate<T[]> {
  const data = (result.data ?? []) as T[];
  const errors = result.errors ?? [];
  const attempted = result.attempted ?? 0;
  if (attempted > 0 && errors.length === attempted) {
    const allTransient = errors.every((e) => TRANSIENT_PLUGIN_CODES.has(e.code));
    if (!allTransient) {
      throw new AllPluginsFailedError(
        capabilityKey,
        errors.map((e) => ({ pluginId: e.pluginId, code: e.code, devMessage: e.devMessage })),
      );
    }
    return { items: data, partial: true };
  }
  return { items: data, partial: errors.length > 0 };
}
