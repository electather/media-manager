import { requireCapability } from "./capability-lookup";
import { dispatchSingle } from "./strategies/single";
import { dispatchAggregate } from "./strategies/aggregate";
import { dispatchPrimary } from "./strategies/primary-with-enrichment";
import type { DispatchRequest, AggregateResult } from "./types";

export type { DispatchRequest, AggregateResult } from "./types";
export { dispatchSingle } from "./strategies/single";
export { dispatchAggregate } from "./strategies/aggregate";
export { dispatchPrimary } from "./strategies/primary-with-enrichment";
export { invalidateUserCache } from "./dispatch-cache";

/**
 * Generic entry point — picks the dispatch function based on the capability's
 * declared strategy. Most callers should prefer the strategy-specific helper
 * so the return type is narrowed at compile time.
 */
export async function dispatch<T = unknown>(
  req: DispatchRequest,
): Promise<T | null | AggregateResult<T>> {
  const capability = requireCapability(req.capability, req.version);
  switch (capability.strategy) {
    case "single":
      return dispatchSingle<T>(req);
    case "aggregate":
      return dispatchAggregate<T>(req);
    case "primary_with_enrichment":
      return dispatchPrimary<T>(req);
    default: {
      const unreachable: never = capability.strategy;
      throw new Error(`unhandled strategy: ${String(unreachable)}`);
    }
  }
}
