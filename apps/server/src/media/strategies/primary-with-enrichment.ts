import { capabilityRegistry } from "../../plugin-runtime/registry";
import { getPrimaryConnection } from "../primary-preference";
import { requireCapability, scopeForRequest, pickSingleConnection } from "../capability-lookup";
import { readCache, writeCache, applyInvalidations } from "../dispatch-cache";
import { invokeOne, harvestFromOutcomes } from "../invoke";
import type { DispatchRequest, AggregateResult } from "../types";

function mergeObjects(base: Record<string, unknown>, extra: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(extra)) {
    const current = base[key];
    const isGap =
      current === null ||
      current === undefined ||
      current === "" ||
      (Array.isArray(current) && current.length === 0);
    if (isGap) {
      base[key] = value;
      continue;
    }
    if (
      typeof current === "object" &&
      !Array.isArray(current) &&
      current !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      value !== null
    ) {
      mergeObjects(current as Record<string, unknown>, value as Record<string, unknown>);
    }
  }
}

/**
 * `primary_with_enrichment`: primary provider's result is the base; enrichment
 * providers fill missing scalar fields and deep-merge the `ids` bundle. Lists
 * (search/discover/trending) come from the primary only.
 */
export async function dispatchPrimary<T>(req: DispatchRequest): Promise<AggregateResult<T>> {
  const capability = requireCapability(req.capability, req.version);
  const scope = scopeForRequest(capability, req.input);
  const cached = await readCache<AggregateResult<T>>(req, scope);
  if (cached !== undefined) return cached;

  const providers = capabilityRegistry.listProviders(req.capability, req.version, scope);
  if (providers.length === 0) {
    return { data: null as T, errors: [], attempted: 0 };
  }

  const primary = await getPrimaryConnection({
    userId: req.userId,
    capabilityKey: `${req.capability}@${req.version}`,
    mediaType: req.mediaType,
  });
  const primaryPlugin = primary?.pluginId ?? providers[0]!;
  const ordered = [primaryPlugin, ...providers.filter((p) => p !== primaryPlugin)];

  const candidates: Array<{
    pluginId: string;
    conn: NonNullable<Awaited<ReturnType<typeof pickSingleConnection>>>;
  }> = [];
  for (const pluginId of ordered) {
    const conn = await pickSingleConnection(req.userId, pluginId);
    if (!conn) continue;
    candidates.push({ pluginId, conn });
  }

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

  const errors: AggregateResult<T>["errors"] = [];
  for (const outcome of outcomes) {
    if (outcome.error && outcome.error.code !== "plugin.item_not_found") {
      errors.push({
        pluginId: outcome.pluginId,
        connectionId: outcome.connectionId,
        code: outcome.error.code,
        devMessage: outcome.error.devMessage,
      });
    }
  }

  const successes = outcomes.filter((o) => !o.error && o.data !== null && o.data !== undefined);
  if (successes.length === 0) {
    const empty: AggregateResult<T> = {
      data: null as T,
      errors,
      attempted: outcomes.length,
    };
    await writeCache(req, capability, scope, empty);
    return empty;
  }

  const first = successes[0]!;
  let merged: T;
  if (Array.isArray(first.data) || typeof first.data !== "object") {
    merged = first.data as T;
  } else {
    const base: Record<string, unknown> = JSON.parse(JSON.stringify(first.data));
    for (const outcome of successes.slice(1)) {
      if (outcome.data && typeof outcome.data === "object" && !Array.isArray(outcome.data)) {
        mergeObjects(base, outcome.data as Record<string, unknown>);
      }
    }
    merged = base as T;
  }

  const result: AggregateResult<T> = {
    data: merged,
    errors,
    attempted: outcomes.length,
  };
  await writeCache(req, capability, scope, result);
  await applyInvalidations(req, capability);
  return result;
}
