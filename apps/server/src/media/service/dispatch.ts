import { invariant } from "es-toolkit/util";
import { requireCapability } from "../internal/capability-lookup";
import { dispatchSingle } from "../internal/strategies/single";
import { dispatchAggregate } from "../internal/strategies/aggregate";
import { dispatchPrimary } from "../internal/strategies/primary-with-enrichment";
import { dispatchAggregatePerKind } from "../internal/strategies/aggregate-per-kind";
import type { DispatchRequest, AggregateResult } from "../types";

export type { DispatchRequest, AggregateResult } from "../types";
export { dispatchSingle } from "../internal/strategies/single";
export { dispatchAggregate } from "../internal/strategies/aggregate";
export { dispatchPrimary } from "../internal/strategies/primary-with-enrichment";
export { dispatchAggregatePerKind } from "../internal/strategies/aggregate-per-kind";
export { invalidateUserCache } from "../internal/dispatch-cache";

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
// fallow-ignore-next-line complexity
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
      invariant(false, `unhandled strategy: ${String(unreachable)}`);
    }
  }
}
