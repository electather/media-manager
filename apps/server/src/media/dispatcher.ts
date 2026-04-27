import { requireCapability } from "./capability-lookup";
import { dispatchSingle } from "./strategies/single";
import { dispatchAggregate } from "./strategies/aggregate";
import { dispatchPrimary } from "./strategies/primary-with-enrichment";
import { dispatchAggregatePerKind } from "./strategies/aggregate-per-kind";
import type { DispatchRequest, AggregateResult } from "./types";

export type { DispatchRequest, AggregateResult } from "./types";
export { dispatchSingle } from "./strategies/single";
export { dispatchAggregate } from "./strategies/aggregate";
export { dispatchPrimary } from "./strategies/primary-with-enrichment";
export { dispatchAggregatePerKind } from "./strategies/aggregate-per-kind";
export { invalidateUserCache } from "./dispatch-cache";

/**
 * Generic entry point — picks the dispatch function based on the capability's
 * declared strategy. Most callers should prefer the strategy-specific helper
 * so the return type is narrowed at compile time.
 *
 * Note: the `aggregate_per_kind` branch returns `Promise<T>` cast from
 * `Promise<Record<string, unknown[]>>`. Callers using `dispatch` for
 * per-kind capabilities should call `dispatchAggregatePerKind` directly
 * to keep the bundle shape in the type.
 */
export async function dispatch<T = unknown>(
  req: DispatchRequest,
): Promise<T | null | AggregateResult<T>> {
  const capability = requireCapability(req.capability, req.version);
  switch (capability.strategy.kind) {
    case "single":
      return dispatchSingle<T>(req);
    case "aggregate":
      return dispatchAggregate<T>(req);
    case "primary_with_enrichment":
      return dispatchPrimary<T>(req);
    case "aggregate_per_kind":
      return dispatchAggregatePerKind<T>(req) as Promise<T>;
    default: {
      const unreachable: never = capability.strategy;
      throw new Error(`unhandled strategy: ${String(unreachable)}`);
    }
  }
}
