import { cloneDeep } from "es-toolkit/object";
import { getPrimaryConnection } from "../primary-preference";
import { pickSingleConnection } from "../capability-lookup";
import { writeCache, applyInvalidations, NEGATIVE_TTL_MS } from "../dispatch-cache";
import { harvestFromOutcomes } from "../invoke";
import type { InvocationOutcome } from "../errors";
import type { DispatchRequest, AggregateResult } from "../types";
import { invokeAll, collectErrors, resolveDispatchPreamble, type Candidate } from "./shared";

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined || v === "") return true;
  return Array.isArray(v) && v.length === 0;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fillGaps(base: Record<string, unknown>, extra: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(extra)) {
    const current = base[key];
    if (isEmptyValue(current)) {
      base[key] = value;
      continue;
    }
    if (isPlainObject(current) && isPlainObject(value)) {
      fillGaps(current, value);
    }
  }
}

async function resolveOrderedCandidates(
  userId: string,
  orderedPluginIds: string[],
): Promise<Candidate[]> {
  const conns = await Promise.all(
    orderedPluginIds.map((pluginId) => pickSingleConnection(userId, pluginId)),
  );
  return orderedPluginIds
    .map((pluginId, i) => (conns[i] ? { pluginId, conn: conns[i]! } : null))
    .filter((c): c is Candidate => c !== null);
}

function mergeEnrichedResults<T>(successes: Array<InvocationOutcome<T>>): T {
  const first = successes[0]!;
  if (Array.isArray(first.data) || typeof first.data !== "object") {
    return first.data as T;
  }
  const base: Record<string, unknown> = cloneDeep(first.data as Record<string, unknown>);
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
  const { capability, scope, cached, providers } =
    await resolveDispatchPreamble<AggregateResult<T>>(req);
  if (cached !== undefined) return cached;
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
