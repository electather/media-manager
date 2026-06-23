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
 * Generic entry point selecting dispatch function by capability strategy.
 * Note: `aggregate_per_kind` returns `Promise<T>` cast from
 * `Promise<Record<string, unknown[]>>` — callers should prefer
 * `dispatchAggregatePerKind` directly to preserve bundle shape in type.
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
