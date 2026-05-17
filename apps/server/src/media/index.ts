export { MediaService } from "./service";
export type { MatchingServer, HomeAggregate } from "./service";
export { interpretAggregate } from "./service";
export {
  dispatch,
  dispatchSingle,
  dispatchAggregate,
  dispatchPrimary,
  dispatchAggregatePerKind,
  invalidateUserCache,
} from "./dispatcher";
export type { DispatchRequest, AggregateResult } from "./dispatcher";
export { dispatchAggregatePerKind as dispatchAggregatePerKindStrategy } from "./strategies/aggregate-per-kind";
export {
  identifyItem,
  parseHistoryBase,
  parseItemDate,
  splitCombinedId,
  type RawPluginItem,
  type ItemIdentity,
} from "./parse-item";
export { compactFromRaw, type PluginMediaRaw } from "./compact";
export {
  listEligibleConnections,
  dispatchToConnection,
  type EligibleConnection,
  type TargetedDispatchRequest,
} from "./connection-targeted";
export {
  PluginCallError,
  AllPluginsFailedError,
  mapRequestPluginError,
  normalizeError,
  type InvocationOutcome,
} from "./errors";
export { invokeOne, invokeWithTimeout, harvestFromOutcomes, type InvokeRequest } from "./invoke";
export { requireCapability, scopeForRequest, pickSingleConnection } from "./capability-lookup";
export { resolveConnections, type ResolvedConnection } from "./resolve-connection";
