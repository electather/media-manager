import { capabilityRegistry } from "../../plugin-runtime/registry";
import { resolveConnections } from "../resolve-connection";
import { requireCapability, scopeForRequest } from "../capability-lookup";
import { readCache, writeCache, applyInvalidations } from "../dispatch-cache";
import { invokeOne, harvestFromOutcomes } from "../invoke";
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

  const outcomes = await Promise.all(
    candidates.map(({ pluginId, conn }) =>
      invokeOne<T>(
        {
          userId: req.userId,
          pluginId,
          capability: req.capability,
          version: req.version,
          method: req.method,
          input: req.input,
          timeoutMs: capability.defaultTimeoutMs,
        },
        conn,
      ),
    ),
  );
  await harvestFromOutcomes(outcomes, req.mediaType);

  const data: unknown[] = [];
  const errors: AggregateResult<T>["errors"] = [];
  for (const outcome of outcomes) {
    if (outcome.error) {
      if (outcome.error.code === "plugin.item_not_found") continue;
      errors.push({
        pluginId: outcome.pluginId,
        connectionId: outcome.connectionId,
        code: outcome.error.code,
        devMessage: outcome.error.devMessage,
      });
      continue;
    }
    if (Array.isArray(outcome.data)) {
      data.push(...outcome.data);
    } else if (outcome.data !== null && outcome.data !== undefined) {
      data.push(outcome.data);
    }
  }
  const result: AggregateResult<T> = {
    data: data as T,
    errors,
    attempted: outcomes.length,
  };
  await writeCache(req, capability, scope, result);
  await applyInvalidations(req, capability);
  return result;
}
