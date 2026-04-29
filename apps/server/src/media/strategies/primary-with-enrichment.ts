import { capabilityRegistry } from "../../plugin-runtime/registry";
import { getPrimaryConnection } from "../primary-preference";
import { pickSingleConnection } from "../capability-lookup";
import { readCache, writeCache, applyInvalidations, NEGATIVE_TTL_MS } from "../dispatch-cache";
import { harvestFromOutcomes } from "../invoke";
import type { InvocationOutcome } from "../errors";
import type { DispatchRequest, AggregateResult } from "../types";
import { invokeAll, collectErrors, resolveCapabilityScope, type Candidate } from "./shared";

function fillGaps(base: Record<string, unknown>, extra: Record<string, unknown>): void {
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
      fillGaps(current as Record<string, unknown>, value as Record<string, unknown>);
    }
  }
}

async function resolveOrderedCandidates(
  userId: string,
  orderedPluginIds: string[],
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  for (const pluginId of orderedPluginIds) {
    const conn = await pickSingleConnection(userId, pluginId);
    if (conn) candidates.push({ pluginId, conn });
  }
  return candidates;
}

function mergeEnrichedResults<T>(successes: Array<InvocationOutcome<T>>): T {
  const first = successes[0]!;
  if (Array.isArray(first.data) || typeof first.data !== "object") {
    return first.data as T;
  }
  const base: Record<string, unknown> = structuredClone(first.data as Record<string, unknown>);
  for (const outcome of successes.slice(1)) {
    if (outcome.data && typeof outcome.data === "object" && !Array.isArray(outcome.data)) {
      fillGaps(base, outcome.data as Record<string, unknown>);
    }
  }
  return base as T;
}

/**
 * `primary_with_enrichment`: primary provider's result is the base; enrichment
 * providers fill missing scalar fields and deep-merge the `ids` bundle. Lists
 * (search/discover/trending) come from the primary only.
 */
export async function dispatchPrimary<T>(req: DispatchRequest): Promise<AggregateResult<T>> {
  const { capability, scope } = resolveCapabilityScope(req);
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
  const candidates = await resolveOrderedCandidates(req.userId, ordered);

  const outcomes = await invokeAll<T>(candidates, req, capability);
  await harvestFromOutcomes(outcomes, req.mediaType);

  const errors = collectErrors(outcomes);
  const successes = outcomes.filter((o) => !o.error && o.data !== null && o.data !== undefined);
  if (successes.length === 0) {
    const empty: AggregateResult<T> = { data: null as T, errors, attempted: outcomes.length };
    // Distinguish two no-data cases. All-fail (every provider errored) is
    // transient — a TMDB rate-limit storm should not poison the 24h positive
    // cache. All-succeed-with-no-data is a stable absence and uses the
    // capability's normal TTL via ttlMsFor.
    //
    // `errors` excludes `plugin.item_not_found` (see filter above), so a
    // provider that returns "no such item" does not count toward all-fail —
    // that outcome is a stable absence, not a transient failure, and should
    // use the capability's regular TTL.
    const isAllFail = outcomes.length > 0 && errors.length === outcomes.length;
    await writeCache(req, capability, scope, empty, isAllFail ? NEGATIVE_TTL_MS : undefined);
    return empty;
  }

  const result: AggregateResult<T> = {
    data: mergeEnrichedResults(successes),
    errors,
    attempted: outcomes.length,
  };
  await writeCache(req, capability, scope, result);
  await applyInvalidations(req, capability);
  return result;
}
