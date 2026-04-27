import { consola } from "consola";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { serviceConnections } from "../db/schema";
import { capabilityRegistry } from "../plugin-runtime/registry";
import { pluginRuntime } from "../plugin-runtime/runtime";
import { getCapability, artworkV1ManifestExtrasSchema } from "@ent-mcp/plugin-sdk";
import { encryptJson } from "../crypto/helpers";
import type { CapabilityDefinition, ResolvedCapabilityScope } from "@ent-mcp/plugin-sdk";
import { resolveConnections, type ResolvedConnection } from "./resolve-connection";
import { getPrimaryConnection } from "./primary-preference";
import { harvestIds } from "./id-resolver";
import type { HostErrorCode } from "@ent-mcp/shared/errors";
import { type InvocationOutcome, PluginCallError, normalizeError } from "./errors";
import { cacheKey, getCacheProvider, ttlMsFor } from "./cache";
import { emit } from "../notifications/emit";

async function emitAuthExpired(args: {
  connectionId: string;
  pluginId: string;
  userId: string;
}): Promise<void> {
  try {
    await emit({
      type: "connection.auth.expired",
      category: "auth",
      severity: "warn",
      audience: { kind: "user", userId: args.userId },
      payload: { connectionId: args.connectionId, pluginId: args.pluginId },
    });
  } catch (err) {
    consola.error("[dispatcher] auth-expired notification emit failed:", err);
  }
}

async function persistRefreshedCredentials(connectionId: string, credentials: unknown) {
  const { iv, data } = await encryptJson(credentials);
  await getDb()
    .update(serviceConnections)
    .set({
      encryptedCredentials: data,
      credentialsIv: iv,
      status: "connected",
      errorMessage: null,
      lastVerifiedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .where(eq(serviceConnections.id, connectionId));
}

async function markConnectionStatus(
  connectionId: string | null,
  status: "expired" | "error",
  message: string,
) {
  if (!connectionId) return;
  await getDb()
    .update(serviceConnections)
    .set({ status, errorMessage: message, updatedAt: Date.now() })
    .where(eq(serviceConnections.id, connectionId));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface InvokeRequest {
  userId: string;
  pluginId: string;
  capability: string;
  version: string;
  method: string;
  input: unknown;
  timeoutMs: number;
}

/**
 * Wraps `pluginRuntime.invoke` with a timeout. Timeouts surface as `timeout`,
 * treated like `transient_network` for retry purposes.
 */
async function invokeWithTimeout<T>(req: InvokeRequest, conn: ResolvedConnection): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`plugin call timed out after ${req.timeoutMs}ms`);
      err.name = "AbortError";
      reject(err);
    }, req.timeoutMs);
  });
  try {
    return (await Promise.race([
      pluginRuntime.invokeWithCredentials<T>({
        pluginId: req.pluginId,
        capability: req.capability,
        version: req.version,
        method: req.method,
        input: req.input,
        userId: req.userId,
        credentials: conn.credentials,
        userConfig: conn.kind === "user" ? conn.userConfig : null,
      }),
      timeoutPromise,
    ])) as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Resolves which scope a single dispatch request should execute under. This
 * value drives two parallel lookups that MUST agree for correctness:
 *   1. Provider enumeration (`capabilityRegistry.listProviders(…, scope)`).
 *   2. Cache keying (`cacheKey({ …, scope })`) — a user-scoped result must
 *      live in a userId-qualified key so it can't be served to other users.
 *
 * For `scope: "global"` / `"user"` capabilities this is a constant; for
 * `"mixed"` capabilities (today: `idResolve@v1`) the capability's
 * `scopeForInput` classifies the request — typically by looking at the
 * input's id kind. Each dispatch strategy computes this once at entry and
 * threads the result through every subsequent step so a future impure
 * classifier cannot observe or diverge across the lookups.
 *
 * The discriminated union on `CapabilityDefinition` guarantees at the type
 * level that `scopeForInput` is present whenever `scope === "mixed"`, so
 * no runtime guard is needed here — a malformed capability defined via an
 * `as any` cast would fail on the subsequent call with a descriptive
 * TypeError.
 */
function scopeForRequest(
  capability: CapabilityDefinition,
  input: unknown,
): ResolvedCapabilityScope {
  if (capability.scope === "mixed") return capability.scopeForInput(input);
  return capability.scope;
}

/**
 * Invokes a single plugin with retry/refresh logic:
 *   • `token_expired` → refresh credentials, retry once.
 *   • `rate_limited`  → 2s backoff, retry once.
 *   • `transient_network` / `timeout` → 1s backoff, retry once.
 * Other codes propagate immediately as an outcome error.
 */
async function invokeOne<T>(
  req: InvokeRequest,
  conn: ResolvedConnection,
): Promise<InvocationOutcome<T>> {
  let activeConn = conn;
  let triedRefresh = false;
  let triedRateLimit = false;
  let triedTransient = false;

  while (true) {
    try {
      const data = await invokeWithTimeout<T>(req, activeConn);
      return {
        pluginId: req.pluginId,
        connectionId: conn.kind === "user" ? conn.connectionId : null,
        shared: conn.kind === "shared",
        data,
      };
    } catch (err) {
      const normalized = normalizeError(err);
      if (normalized.code === "plugin.token_expired" && !triedRefresh && conn.kind === "user") {
        triedRefresh = true;
        try {
          const refreshed = await pluginRuntime.refreshAuth(
            req.pluginId,
            req.userId,
            activeConn.credentials,
          );
          await persistRefreshedCredentials(conn.connectionId, refreshed);
          activeConn = { ...activeConn, credentials: refreshed };
          continue;
        } catch (refreshErr) {
          const refreshMsg = refreshErr instanceof Error ? refreshErr.message : String(refreshErr);
          await markConnectionStatus(conn.connectionId, "expired", refreshMsg);
          await emitAuthExpired({
            connectionId: conn.connectionId,
            pluginId: req.pluginId,
            userId: req.userId,
          });
          return {
            pluginId: req.pluginId,
            connectionId: conn.connectionId,
            shared: false,
            error: { code: "plugin.token_expired", devMessage: refreshMsg },
          };
        }
      }
      if (normalized.code === "plugin.rate_limited" && !triedRateLimit) {
        triedRateLimit = true;
        await sleep(2_000);
        continue;
      }
      if (
        (normalized.code === "plugin.upstream_error" || normalized.code === "plugin.timeout") &&
        !triedTransient
      ) {
        triedTransient = true;
        await sleep(1_000);
        continue;
      }
      if (
        normalized.code === "plugin.bad_credentials" ||
        normalized.code === "plugin.upstream_error"
      ) {
        await markConnectionStatus(
          conn.kind === "user" ? conn.connectionId : null,
          "error",
          normalized.devMessage,
        );
      }
      return {
        pluginId: req.pluginId,
        connectionId: conn.kind === "user" ? conn.connectionId : null,
        shared: conn.kind === "shared",
        error: normalized,
      };
    }
  }
}

export interface DispatchRequest {
  userId: string;
  capability: string;
  version: string;
  method: string;
  input: unknown;
  /** Optional explicit plugin id (overrides registry enumeration; used by gap-fill). */
  pluginId?: string;
  /** Optional media type for primary-connection lookup (metadata@v1). */
  mediaType?: "movie" | "tv";
  /** Skip cache read/write (e.g. for mutations or forced refresh). */
  skipCache?: boolean;
}

export interface AggregateResult<T> {
  data: T;
  errors: Array<{
    pluginId: string;
    connectionId: string | null;
    code: HostErrorCode;
    devMessage: string;
  }>;
  /**
   * Total number of providers contacted (successes + errors). Lets callers
   * disambiguate "no providers installed" (attempted=0) from "every provider
   * errored" (attempted=errors.length) from "some succeeded but had nothing
   * to contribute" (attempted > errors.length, data empty).
   */
  attempted: number;
}

/**
 * Harvests opportunistic id_map entries from any successful outcome. Best-effort;
 * failures are swallowed (harvestIds logs internally).
 */
async function harvestFromOutcomes(
  outcomes: Array<InvocationOutcome<unknown>>,
  mediaType?: "movie" | "tv",
): Promise<void> {
  const installed = new Set(capabilityRegistry.all().map((e) => e.pluginId));
  for (const outcome of outcomes) {
    if (!outcome.data) continue;
    try {
      await harvestIds(
        outcome.data,
        { pluginId: outcome.pluginId, installedPlugins: installed },
        mediaType,
      );
    } catch (err) {
      consola.debug(`[dispatcher] harvestIds failed for ${outcome.pluginId}`, err);
    }
  }
}

function cacheKeyFor(req: DispatchRequest, scope: ResolvedCapabilityScope): Promise<string> {
  return cacheKey({
    capability: req.capability,
    version: req.version,
    method: req.method,
    userId: req.userId,
    scope,
    input: req.input,
  });
}

async function readCache<T>(
  req: DispatchRequest,
  scope: ResolvedCapabilityScope,
): Promise<T | undefined> {
  if (req.skipCache) return undefined;
  const key = await cacheKeyFor(req, scope);
  // Values are wrapped in { v } so a negatively-cached `null` is distinguishable
  // from a cache miss (both would otherwise serialize to `null`).
  const cached = await getCacheProvider().get<{ v: T }>(key);
  if (cached === null) return undefined;
  return cached.v;
}

async function writeCache<T>(
  req: DispatchRequest,
  capability: CapabilityDefinition,
  scope: ResolvedCapabilityScope,
  value: T,
): Promise<void> {
  if (req.skipCache) return;
  const key = await cacheKeyFor(req, scope);
  const ttl = ttlMsFor(capability, value);
  await getCacheProvider().set(key, { v: value }, ttl);
}

async function applyInvalidations(
  req: DispatchRequest,
  capability: CapabilityDefinition,
): Promise<void> {
  const methodSpec = capability.methods[req.method];
  if (!methodSpec?.invalidates?.length) return;
  const provider = getCacheProvider();
  for (const key of methodSpec.invalidates) {
    const [capId, version] = key.split("@");
    if (!capId || !version) continue;
    await provider.clear(`mv:${capId}:${version}:`);
  }
}

function requireCapability(id: string, version: string): CapabilityDefinition {
  const cap = getCapability(id, version);
  if (!cap) {
    throw new PluginCallError(
      "plugin.missing_method",
      `unknown capability ${id}@${version}`,
      "",
      null,
    );
  }
  return cap;
}

async function pickSingleConnection(
  userId: string,
  pluginId: string,
): Promise<ResolvedConnection | null> {
  const all = await resolveConnections(userId, pluginId);
  return all[0] ?? null;
}

/**
 * `single` strategy: one connection, no fan-out. Returns the plugin's data or
 * `null` (for `not_found`); throws `PluginCallError` on any other failure.
 */
export async function dispatchSingle<T>(req: DispatchRequest): Promise<T | null> {
  const capability = requireCapability(req.capability, req.version);
  const scope = scopeForRequest(capability, req.input);
  const cached = await readCache<T | null>(req, scope);
  if (cached !== undefined) return cached;

  const providers = capabilityRegistry.listProviders(req.capability, req.version, scope);
  if (providers.length === 0) {
    throw new PluginCallError(
      "plugin.call_failed",
      `no provider installed for ${req.capability}@${req.version}`,
      "",
      null,
    );
  }
  const pluginId = req.pluginId && providers.includes(req.pluginId) ? req.pluginId : providers[0]!;
  const conn = await pickSingleConnection(req.userId, pluginId);
  if (!conn) {
    throw new PluginCallError(
      "media.no_connection",
      `no connection available for plugin ${pluginId}`,
      pluginId,
      null,
    );
  }

  const outcome = await invokeOne<T>(
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
  );
  if (outcome.error) {
    if (outcome.error.code === "plugin.item_not_found") {
      await writeCache<T | null>(req, capability, scope, null);
      return null;
    }
    throw new PluginCallError(
      outcome.error.code,
      outcome.error.devMessage,
      outcome.pluginId,
      outcome.connectionId,
    );
  }
  await harvestFromOutcomes([outcome], req.mediaType);
  const value = (outcome.data ?? null) as T | null;
  await writeCache(req, capability, scope, value);
  await applyInvalidations(req, capability);
  return value;
}

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
  const candidates: Array<{ pluginId: string; conn: ResolvedConnection }> = [];
  for (const pluginId of providers) {
    const connections = await resolveConnections(req.userId, pluginId);
    for (const conn of connections) candidates.push({ pluginId, conn });
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

  const candidates: Array<{ pluginId: string; conn: ResolvedConnection }> = [];
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

/**
 * Reads optional capability extras from a plugin's manifest. Strategies like
 * `aggregate_per_kind` declare per-provider hints there (`supportedIdTypes`,
 * `providerPriority`); the manifest schema lets capability declarations carry
 * extra keys, so we read whatever shape the capability defines.
 */
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

interface PerKindProvider {
  pluginId: string;
  supportedIdTypes: { movie: readonly string[]; tv: readonly string[] };
  providerPriority: number;
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

/**
 * Generic entry point — picks the dispatch function based on the capability's
 * declared strategy. Most callers should prefer the strategy-specific helper
 * so the return type is narrowed at compile time.
 */
export async function dispatch<T = unknown>(
  req: DispatchRequest,
): Promise<T | null | AggregateResult<T>> {
  const capability = requireCapability(req.capability, req.version);
  switch (capability.strategy.kind) {
    case "single":
      return dispatchSingle<T>(req);
    case "aggregate":
      return dispatchAggregate<T>(req);
    case "primary_with_enrichment":
      return dispatchPrimary<T>(req);
    case "aggregate_per_kind":
      return dispatchAggregatePerKind<T>(req) as Promise<T>;
    default: {
      const unreachable: never = capability.strategy;
      throw new Error(`unhandled strategy: ${String(unreachable)}`);
    }
  }
}

/**
 * Clears every `mv:` cache entry. Called on connection create/update/delete/
 * enable/disable since most scoped keys depend on the active connection set.
 * The memory cache does not support non-prefix matching, so a broad sweep is
 * simpler and correctness-preserving. Redis could later scan by user prefix.
 */
export async function invalidateUserCache(userId: string): Promise<void> {
  await getCacheProvider().clear(`mv:`);
  void userId;
}
