import { orderBy, zip } from "es-toolkit/array";
import { isNil, isNotNil } from "es-toolkit/predicate";
import { invariant } from "es-toolkit/util";
import { consola } from "consola";
import { z } from "zod";
import { mediaTypeSchema } from "@nama/shared";
import { artworkV1ManifestExtrasSchema } from "@nama/plugin-sdk";
import type { ResolvedCapabilityScope } from "@nama/plugin-sdk";
import { capabilityRegistry } from "../../../plugin-runtime";
import { requireCapability, scopeForRequest, pickSingleConnection } from "../capability-lookup";
import { readCache, writeCache, applyInvalidations, NEGATIVE_TTL_MS } from "../dispatch-cache";
import { invokeOne } from "../../service/invoke";
import { PluginCallError, type InvocationOutcome } from "../../errors";
import type { DispatchRequest } from "../../types";

const perKindInputSchema = z.object({
  ids: z.record(z.string(), z.unknown()).optional(),
  type: mediaTypeSchema.optional(),
});

interface PerKindProvider {
  pluginId: string;
  supportedIdTypes: { movie: readonly string[]; tv: readonly string[] };
  providerPriority: number;
}

function readCapabilityExtras(
  pluginId: string,
  capability: string,
): Record<string, unknown> | null {
  const entry = capabilityRegistry.get(pluginId);
  if (!entry) return null;
  const declared = entry.module.manifest.capabilities[capability] as
    | Record<string, unknown>
    | undefined;
  return declared ?? null;
}

function readPerKindProvider(pluginId: string, capability: string): PerKindProvider | null {
  const extras = readCapabilityExtras(pluginId, capability);
  if (!extras) return null;
  // artwork@v1 is the only aggregate_per_kind capability today, so its schema
  // defines the manifest contract. Future per-kind capabilities can dispatch
  // on `capability` here when they land.
  const parsed = artworkV1ManifestExtrasSchema.safeParse(extras);
  if (!parsed.success) {
    consola.warn(
      `[dispatcher] plugin ${pluginId} declares ${capability}@v1 with malformed manifest extras; ` +
        `excluded from dispatch. Errors: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
    return null;
  }
  return {
    pluginId,
    supportedIdTypes: {
      movie: parsed.data.supportedIdTypes.movie,
      tv: parsed.data.supportedIdTypes.tv,
    },
    providerPriority: parsed.data.providerPriority,
  };
}

function canServePerKind(
  provider: PerKindProvider,
  ids: Record<string, unknown>,
  type: "movie" | "tv",
): boolean {
  return provider.supportedIdTypes[type].some((t) => isNotNil(ids[t]));
}

// fallow-ignore-next-line complexity
function parsePerKindInput(input: unknown): {
  ids: Record<string, unknown>;
  mediaType: "movie" | "tv";
} {
  const parsed = perKindInputSchema.safeParse(input ?? {});
  if (!parsed.success || isNil(parsed.data.type)) {
    throw new PluginCallError(
      "artwork.bad_input",
      `aggregate_per_kind input must include type: "movie" | "tv"`,
      "",
      null,
    );
  }
  return { ids: parsed.data.ids ?? {}, mediaType: parsed.data.type };
}

function selectEligibleProviders(
  capability: string,
  version: string,
  scope: ResolvedCapabilityScope,
  ids: Record<string, unknown>,
  mediaType: "movie" | "tv",
): PerKindProvider[] {
  const providerIds = capabilityRegistry.listProviders(capability, version, scope);
  const providers: PerKindProvider[] = [];
  for (const pid of providerIds) {
    const provider = readPerKindProvider(pid, capability);
    if (provider && canServePerKind(provider, ids, mediaType)) providers.push(provider);
  }
  return providers;
}

function sortByPriority(providers: PerKindProvider[]): PerKindProvider[] {
  // Tie-break alphabetical so merge order is deterministic across boots.
  return orderBy(providers, [(p) => p.providerPriority, (p) => p.pluginId], ["asc", "asc"]);
}

/** `media.no_connection` = provider unconfigured (skip it); any other error propagates. */
function isNoConnection(err: unknown): boolean {
  return err instanceof PluginCallError && err.code === "media.no_connection";
}

/**
 * Returns `null` when provider unconfigured (not a failure); skip entirely to avoid
 * masking other providers' data with a short-TTL negative cache.
 */
async function invokeProvider(
  req: DispatchRequest,
  provider: PerKindProvider,
  timeoutMs: number,
  scope: ResolvedCapabilityScope,
): Promise<InvocationOutcome<Record<string, unknown[]>> | null> {
  let conn;
  try {
    conn = await pickSingleConnection(req.userId, provider.pluginId, scope);
  } catch (err) {
    if (isNoConnection(err)) return null;
    throw err;
  }
  if (!conn) return null;
  return invokeOne<Record<string, unknown[]>>(
    {
      userId: req.userId,
      pluginId: provider.pluginId,
      capability: req.capability,
      version: req.version,
      method: req.method,
      input: req.input,
      timeoutMs,
      deadlineMs: req.deadlineMs,
    },
    conn,
  );
}

// fallow-ignore-next-line complexity
function collectSuccessful(
  settled: PromiseSettledResult<InvocationOutcome<Record<string, unknown[]>> | null>[],
  providers: PerKindProvider[],
  req: DispatchRequest,
): { successful: Array<Record<string, unknown[]>>; allFailed: boolean } {
  const successful: Array<Record<string, unknown[]>> = [];
  let attempted = 0;
  let succeeded = 0;
  for (const [outcome, provider] of zip(settled, providers)) {
    if (!outcome || !provider) continue;
    if (outcome.status !== "fulfilled") {
      attempted += 1;
      consola.debug(
        `[dispatcher] ${req.capability}@${req.version} provider ${provider.pluginId} rejected:`,
        outcome.reason,
      );
      continue;
    }
    const result = outcome.value;
    // `null` = provider had no connection and was skipped (see invokeProvider).
    // A skip is not an attempt, so it neither counts toward all-failed nor
    // toward success — a missing provider must not turn a partial success into
    // an all-failed negative cache.
    if (result === null) continue;
    attempted += 1;
    if (result.error) {
      consola.debug(
        `[dispatcher] ${req.capability}@${req.version} provider ${provider.pluginId} errored:`,
        result.error.code,
      );
      continue;
    }
    succeeded += 1;
    if (result.data && typeof result.data === "object" && !Array.isArray(result.data)) {
      successful.push(result.data as Record<string, unknown[]>);
    }
  }
  // All-failed only when at least one provider was actually attempted and every
  // attempt failed. Zero attempts (every provider skipped) is treated as a
  // stable empty, not a transient outage.
  const allFailed = attempted > 0 && succeeded === 0;
  return { successful, allFailed };
}

function mergeBundle(
  perKindFields: readonly string[],
  successful: Array<Record<string, unknown[]>>,
): Record<string, unknown[]> {
  return Object.fromEntries(
    perKindFields.map((field) => {
      const winner = successful.find(
        (r) => Array.isArray(r[field]) && (r[field] as unknown[]).length > 0,
      );
      return [field, winner?.[field] ?? []];
    }),
  );
}

// Dispatches eligible providers in parallel, merges per-kind by priority (first non-empty wins).
// Eligibility = manifest's supportedIdTypes[type] overlaps request ids. All-empty cached negative; all-fail not.
// fallow-ignore-next-line complexity
export async function dispatchAggregatePerKind<T = Record<string, unknown[]>>(
  req: DispatchRequest,
): Promise<T> {
  const capability = requireCapability(req.capability, req.version);
  invariant(
    capability.strategy.kind === "aggregate_per_kind",
    `dispatchAggregatePerKind called for capability ${req.capability}@${req.version} ` +
      `with strategy ${capability.strategy.kind}`,
  );
  const perKindFields = capability.strategy.perKindFields;
  const scope = scopeForRequest(capability, req.input);

  const cached = await readCache<T>(req, scope);
  if (cached !== undefined) return cached;

  const { ids, mediaType } = parsePerKindInput(req.input);

  const eligible = selectEligibleProviders(req.capability, req.version, scope, ids, mediaType);
  if (eligible.length === 0) {
    throw new PluginCallError(
      "artwork.unsupported_id_combo",
      `no provider can serve ${req.capability}@${req.version} for type=${mediaType} ` +
        `with ids=${Object.keys(ids).join(",") || "(none)"}`,
      "",
      null,
    );
  }
  // Sort = merge-priority ordering only. Dispatch fires in parallel below
  // regardless of order; priority decides who wins per-kind during merge.
  const providers = sortByPriority(eligible);

  const settled = await Promise.allSettled(
    providers.map((p) => invokeProvider(req, p, capability.defaultTimeoutMs, scope)),
  );

  const { successful, allFailed } = collectSuccessful(settled, providers, req);
  const bundle = mergeBundle(perKindFields, successful);

  // All-fail (every provider threw or errored) is treated as transient and
  // cached at a short NEGATIVE_TTL_MS so retries do not amplify pressure on
  // upstreams. All-empty (every provider returned empty bundle) is a stable
  // negative cached at the capability's regular TTL.
  await writeCache(req, capability, scope, bundle as T, allFailed ? NEGATIVE_TTL_MS : undefined);
  if (!allFailed) {
    // Intentionally no harvestFromOutcomes — artwork bundles carry URLs and
    // language tags, not cross-service id mappings, so there's nothing to
    // contribute to id_map.
    await applyInvalidations(req, capability);
  }
  return bundle as T;
}
