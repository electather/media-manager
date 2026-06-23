import { compact } from "es-toolkit/array";
import { isNil, isPlainObject } from "es-toolkit/predicate";
import type { ResolvedCapabilityScope } from "@nama/plugin-sdk";
import { getPrimaryConnection } from "../../service/primary-preference";
import { pickSingleConnection } from "../capability-lookup";
import { writeCache, applyInvalidations, NEGATIVE_TTL_MS } from "../dispatch-cache";
import { harvestFromOutcomes } from "../../service/invoke";
import type { InvocationOutcome } from "../../errors";
import type { DispatchRequest, AggregateResult } from "../../types";
import { invokeAll, collectErrors, resolveDispatchPreamble, type Candidate } from "./shared";

// Plugin responses cross a trust boundary; JSON.parse preserves `__proto__` as own property.
// See docs/media-service.md "Response Merge Safety" (#451). Blocks prototype pollution via
// `__proto__`, constructor-chain attacks, and future function-prototype edge cases.
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isEmptyValue(v: unknown): boolean {
  if (isNil(v) || v === "") return true;
  return Array.isArray(v) && v.length === 0;
}

function safeCloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeCloneValue);
  if (isPlainObject(value)) return safeClone(value as Record<string, unknown>);
  return value;
}

function safeClone(src: Record<string, unknown>): Record<string, unknown> {
  // Plain `{}` is intentional; null-prototype base would break callers relying on
  // `Object.prototype` methods (`hasOwnProperty`, `toString`) on nested objects like `result.data.ids`.
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    out[key] = safeCloneValue(src[key]);
  }
  return out;
}

// fallow-ignore-next-line complexity
function fillGaps(base: Record<string, unknown>, extra: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(extra)) {
    // `extra` is always a `safeClone` result today, so this guard is redundant
    // at the current call site. Kept as defense-in-depth: if a future caller
    // passes raw plugin data through `fillGaps`, the merge stays safe.
    if (DANGEROUS_KEYS.has(key)) continue;
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
  scope: ResolvedCapabilityScope,
): Promise<Candidate[]> {
  const conns = await Promise.all(
    orderedPluginIds.map((pluginId) => pickSingleConnection(userId, pluginId, scope)),
  );
  return compact(
    orderedPluginIds.map((pluginId, i) => {
      const conn = conns[i];
      return conn ? { pluginId, conn } : null;
    }),
  );
}

// fallow-ignore-next-line complexity
function mergeEnrichedResults<T>(successes: Array<InvocationOutcome<T>>): T {
  const [first, ...rest] = successes;
  // `dispatchPrimary` filters `data === null` out of `successes` before
  // calling here, so the null branch is an unreachable defensive guard —
  // not a supported code path. Kept so a future caller bypassing the filter
  // degrades gracefully instead of crashing on a null `base`.
  if (first!.data === null || typeof first!.data !== "object" || Array.isArray(first!.data)) {
    return first!.data as T;
  }
  const base = safeClone(first!.data as Record<string, unknown>);
  for (const outcome of rest) {
    if (outcome.data && typeof outcome.data === "object" && !Array.isArray(outcome.data)) {
      const sanitized = safeClone(outcome.data as Record<string, unknown>);
      fillGaps(base, sanitized);
    }
  }
  return base as T;
}

/**
 * `primary_with_enrichment`: primary provider's result is the base; enrichment
 * providers fill missing scalar fields and deep-merge the `ids` bundle. Lists
 * (search/discover/trending) come from the primary only.
 */
// fallow-ignore-next-line complexity
export async function dispatchPrimary<T>(req: DispatchRequest): Promise<AggregateResult<T>> {
  const { capability, scope, cached, providers } =
    await resolveDispatchPreamble<AggregateResult<T>>(req);
  if (cached !== undefined) return cached;
  if (providers.length === 0) {
    return { data: null, errors: [], attempted: 0 };
  }

  const primary = await getPrimaryConnection({
    userId: req.userId,
    capabilityKey: `${req.capability}@${req.version}`,
    mediaType: req.mediaType,
  });
  const primaryPlugin = primary?.pluginId ?? providers[0]!;
  const ordered = [primaryPlugin, ...providers.filter((p) => p !== primaryPlugin)];
  const candidates = await resolveOrderedCandidates(req.userId, ordered, scope);

  const outcomes = await invokeAll<T>(candidates, req, capability);
  await harvestFromOutcomes(outcomes, req.mediaType);

  const errors = collectErrors(outcomes);
  const successes = outcomes.filter((o) => !o.error && o.data !== null && o.data !== undefined);
  if (successes.length === 0) {
    const empty: AggregateResult<T> = { data: null, errors, attempted: outcomes.length };
    // All-fail (every provider errored) uses NEGATIVE_TTL_MS (transient);
    // all-succeed-with-no-data uses normal TTL. `errors` excludes `plugin.item_not_found`
    // (stable absence, not transient failure).
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
