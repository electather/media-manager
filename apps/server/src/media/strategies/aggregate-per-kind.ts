import { orderBy } from "es-toolkit/array";
import { consola } from "consola";
import { z } from "zod";
import { artworkV1ManifestExtrasSchema } from "@ent-mcp/plugin-sdk";

const perKindInputSchema = z.object({
  ids: z.record(z.string(), z.unknown()).optional(),
  type: z.enum(["movie", "tv"]).optional(),
});
import { capabilityRegistry } from "../../plugin-runtime/registry";
import { requireCapability, scopeForRequest, pickSingleConnection } from "../capability-lookup";
import { readCache, writeCache, applyInvalidations, NEGATIVE_TTL_MS } from "../dispatch-cache";
import { invokeOne } from "../invoke";
import { PluginCallError, type InvocationOutcome } from "../errors";
import type { DispatchRequest } from "../types";
import type { ResolvedCapabilityScope } from "@ent-mcp/plugin-sdk";
import { isNil } from "es-toolkit/predicate";

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
  return provider.supportedIdTypes[type].some((t) => Boolean(ids[t]));
}

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

async function invokeProvider(
  req: DispatchRequest,
  provider: PerKindProvider,
  timeoutMs: number,
): Promise<InvocationOutcome<Record<string, unknown[]>>> {
  const conn = await pickSingleConnection(req.userId, provider.pluginId);
  if (!conn) {
    throw new PluginCallError(
      "media.no_connection",
      `no connection available for plugin ${provider.pluginId}`,
      provider.pluginId,
      null,
    );
  }
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
  settled: PromiseSettledResult<InvocationOutcome<Record<string, unknown[]>>>[],
  providers: PerKindProvider[],
  req: DispatchRequest,
): { successful: Array<Record<string, unknown[]>>; allFailed: boolean } {
  const successful: Array<Record<string, unknown[]>> = [];
  let allFailed = true;
  for (const [idx, outcome] of settled.entries()) {
    const provider = providers[idx]!;
    if (outcome.status !== "fulfilled") {
      consola.debug(
        `[dispatcher] ${req.capability}@${req.version} provider ${provider.pluginId} rejected:`,
        outcome.reason,
      );
      continue;
    }
    const result = outcome.value;
    if (result.error) {
      consola.debug(
        `[dispatcher] ${req.capability}@${req.version} provider ${provider.pluginId} errored:`,
        result.error.code,
      );
      continue;
    }
    allFailed = false;
    if (result.data && typeof result.data === "object" && !Array.isArray(result.data)) {
      successful.push(result.data as Record<string, unknown[]>);
    }
  }
  return { successful, allFailed };
}

function mergeBundle(
  perKindFields: readonly string[],
  successful: Array<Record<string, unknown[]>>,
): Record<string, unknown[]> {
  const bundle: Record<string, unknown[]> = {};
  for (const field of perKindFields) bundle[field] = [];
  for (const field of perKindFields) {
    for (const result of successful) {
      const arr = result[field];
      if (Array.isArray(arr) && arr.length > 0) {
        bundle[field] = arr;
        break;
      }
    }
  }
  return bundle;
}

/**
 * `aggregate_per_kind`: dispatch to every eligible provider in parallel and
 * merge per-kind in priority order. First non-empty array wins per kind.
 *
 * Eligibility = manifest's `supportedIdTypes[type]` overlaps the request's
 * `ids` map. Zero eligible providers throws `artwork.unsupported_id_combo`
 * (caller-side bug — the call should never have made it here). All-fail and
 * all-empty paths return an empty bundle (the per-kind fields list defaults
 * to empty arrays); all-empty is cached as a negative, all-fail is not.
 */
// fallow-ignore-next-line complexity
export async function dispatchAggregatePerKind<T = Record<string, unknown[]>>(
  req: DispatchRequest,
): Promise<T> {
  const capability = requireCapability(req.capability, req.version);
  if (capability.strategy.kind !== "aggregate_per_kind") {
    throw new Error(
      `dispatchAggregatePerKind called for capability ${req.capability}@${req.version} ` +
        `with strategy ${capability.strategy.kind}`,
    );
  }
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
    providers.map((p) => invokeProvider(req, p, capability.defaultTimeoutMs)),
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
