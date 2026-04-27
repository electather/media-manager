import { consola } from "consola";
import { artworkV1ManifestExtrasSchema } from "@ent-mcp/plugin-sdk";
import { capabilityRegistry } from "../../plugin-runtime/registry";
import { requireCapability, scopeForRequest, pickSingleConnection } from "../capability-lookup";
import { readCache, writeCache, applyInvalidations } from "../dispatch-cache";
import { invokeOne } from "../invoke";
import { PluginCallError } from "../errors";
import type { DispatchRequest } from "../types";

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

  const input = (req.input ?? {}) as { ids?: Record<string, unknown>; type?: "movie" | "tv" };
  const ids = input.ids ?? {};
  const mediaType = input.type;
  if (mediaType !== "movie" && mediaType !== "tv") {
    throw new PluginCallError(
      "artwork.bad_input",
      `aggregate_per_kind input must include type: "movie" | "tv"`,
      "",
      null,
    );
  }

  const providerIds = capabilityRegistry.listProviders(req.capability, req.version, scope);
  const providers: PerKindProvider[] = [];
  for (const pid of providerIds) {
    const provider = readPerKindProvider(pid, req.capability);
    if (provider && canServePerKind(provider, ids, mediaType)) providers.push(provider);
  }
  if (providers.length === 0) {
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
  // Tie-break alphabetical so the merge order is deterministic across boots.
  providers.sort((a, b) => {
    if (a.providerPriority !== b.providerPriority) {
      return a.providerPriority - b.providerPriority;
    }
    return a.pluginId.localeCompare(b.pluginId);
  });

  const settled = await Promise.allSettled(
    providers.map(async (p) => {
      const conn = await pickSingleConnection(req.userId, p.pluginId);
      if (!conn) {
        throw new PluginCallError(
          "media.no_connection",
          `no connection available for plugin ${p.pluginId}`,
          p.pluginId,
          null,
        );
      }
      return invokeOne<Record<string, unknown[]>>(
        {
          userId: req.userId,
          pluginId: p.pluginId,
          capability: req.capability,
          version: req.version,
          method: req.method,
          input: req.input,
          timeoutMs: capability.defaultTimeoutMs,
        },
        conn,
      );
    }),
  );

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

  // Build empty bundle scaffold from declared perKindFields. First non-empty
  // walks successful results in already-sorted (priority) order.
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

  // All-fail (every provider threw or errored) is treated as a transient
  // miss; do not cache. All-empty (every provider returned empty bundle)
  // is a stable negative — cache it so we stop hammering upstream.
  if (!allFailed) {
    await writeCache(req, capability, scope, bundle as T);
  }
  // Intentionally no harvestFromOutcomes — artwork bundles carry URLs and
  // language tags, not cross-service id mappings, so there's nothing to
  // contribute to id_map.
  await applyInvalidations(req, capability);
  return bundle as T;
}
