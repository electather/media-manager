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

// Four outcomes: (1) attempted=0 → empty,partial=false; (2) all transient errors
// (TRANSIENT_PLUGIN_CODES) → empty,partial=true, self-heals on retry; (3) at least one
// terminal error (auth/bad-input) → AllPluginsFailedError, marks row all_failed; (4) ≥1 success
// → data with partial=true if any peer errored.
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
