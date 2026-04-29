import { capabilityRegistry } from "../../plugin-runtime/registry";
import { resolveConnections } from "../resolve-connection";
import { requireCapability, scopeForRequest } from "../capability-lookup";
import { readCache, writeCache, applyInvalidations } from "../dispatch-cache";
import { harvestFromOutcomes } from "../invoke";
import { invokeAll, collectErrors } from "./shared";
import type { DispatchRequest, AggregateResult } from "../types";

/**
 * `aggregate` strategy: call every (user, plugin) connection in parallel,
 * union array results, collect per-provider errors.
 */
export async function dispatchAggregate<T>(req: DispatchRequest): Promise<AggregateResult<T>> {
  const capability = requireCapability(req.capability, req.version);
  const scope = scopeForRequest(capability, req.input);
  const cached = await readCache<AggregateResult<T>>(req, scope);
  if (cached !== undefined) return cached;

  const providers = capabilityRegistry.listProviders(req.capability, req.version, scope);
  const perPlugin = await Promise.all(
    providers.map(async (pluginId) => {
      const connections = await resolveConnections(req.userId, pluginId);
      return connections.map((conn) => ({ pluginId, conn }));
    }),
  );
  const candidates = perPlugin.flat();

  const outcomes = await invokeAll<T>(candidates, req, capability);
  await harvestFromOutcomes(outcomes, req.mediaType);

  const errors = collectErrors(outcomes);
  const data = outcomes.flatMap((outcome): unknown[] => {
    if (outcome.error) return [];
    if (Array.isArray(outcome.data)) return outcome.data as unknown[];
    return outcome.data != null ? [outcome.data as unknown] : [];
  });

  const result: AggregateResult<T> = {
    data: data as T,
    errors,
    attempted: outcomes.length,
  };
  await writeCache(req, capability, scope, result);
  await applyInvalidations(req, capability);
  return result;
}
