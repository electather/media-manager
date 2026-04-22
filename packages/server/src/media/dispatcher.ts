import { consola } from "consola";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { serviceConnections } from "../db/schema";
import { capabilityRegistry } from "../plugin-runtime/registry";
import { pluginRuntime } from "../plugin-runtime/runtime";
import { getCapability } from "../plugin-runtime/capabilities";
import { encryptJson } from "../crypto/helpers";
import type { CapabilityDefinition, CapabilityScope } from "../plugin-runtime/types";
import { resolveConnections, type ResolvedConnection } from "./resolve-connection";
import { getPrimaryConnection } from "./primary-preference";
import { harvestIds } from "./id-resolver";
import type { HostErrorCode } from "../errors/codes";
import { type InvocationOutcome, PluginCallError, normalizeError } from "./errors";
import { cacheKey, getCacheProvider, ttlMsFor } from "./cache";

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
 * Dispatch routes by the capability's canonical scope (the `userScoped` flag
 * on the host-side definition). The plugin manifest allows a provider to
 * declare the opposite scope (e.g. `metadata` from a personal library as
 * `scope: "user"`); those providers are not discovered by the current
 * dispatcher. If we want to support cross-scope fan-out we also need to decide
 * how results from global and user providers should be merged, which is out of
 * scope for v1.
 */
function scopeFor(capability: CapabilityDefinition): CapabilityScope {
  return capability.userScoped ? "user" : "global";
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

function cacheKeyFor(req: DispatchRequest, capability: CapabilityDefinition): Promise<string> {
  return cacheKey({
    capability: req.capability,
    version: req.version,
    method: req.method,
    userId: req.userId,
    userScoped: capability.userScoped,
    input: req.input,
  });
}

async function readCache<T>(
  req: DispatchRequest,
  capability: CapabilityDefinition,
): Promise<T | undefined> {
  if (req.skipCache) return undefined;
  const key = await cacheKeyFor(req, capability);
  // Values are wrapped in { v } so a negatively-cached `null` is distinguishable
  // from a cache miss (both would otherwise serialize to `null`).
  const cached = await getCacheProvider().get<{ v: T }>(key);
  if (cached === null) return undefined;
  return cached.v;
}

async function writeCache<T>(
  req: DispatchRequest,
  capability: CapabilityDefinition,
  value: T,
): Promise<void> {
  if (req.skipCache) return;
  const key = await cacheKeyFor(req, capability);
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
  const cached = await readCache<T | null>(req, capability);
  if (cached !== undefined) return cached;

  const providers = capabilityRegistry.listProviders(
    req.capability,
    req.version,
    scopeFor(capability),
  );
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
      await writeCache<T | null>(req, capability, null);
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
  await writeCache(req, capability, value);
  await applyInvalidations(req, capability);
  return value;
}

/**
 * `aggregate` strategy: call every (user, plugin) connection in parallel,
 * union array results, collect per-provider errors.
 */
export async function dispatchAggregate<T>(req: DispatchRequest): Promise<AggregateResult<T>> {
  const capability = requireCapability(req.capability, req.version);
  const cached = await readCache<AggregateResult<T>>(req, capability);
  if (cached !== undefined) return cached;

  const providers = capabilityRegistry.listProviders(
    req.capability,
    req.version,
    scopeFor(capability),
  );
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
  const result: AggregateResult<T> = { data: data as T, errors };
  await writeCache(req, capability, result);
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
  const cached = await readCache<AggregateResult<T>>(req, capability);
  if (cached !== undefined) return cached;

  const providers = capabilityRegistry.listProviders(
    req.capability,
    req.version,
    scopeFor(capability),
  );
  if (providers.length === 0) {
    return { data: null as T, errors: [] };
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
    const empty: AggregateResult<T> = { data: null as T, errors };
    await writeCache(req, capability, empty);
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

  const result: AggregateResult<T> = { data: merged, errors };
  await writeCache(req, capability, result);
  await applyInvalidations(req, capability);
  return result;
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
  switch (capability.strategy) {
    case "single":
      return dispatchSingle<T>(req);
    case "aggregate":
      return dispatchAggregate<T>(req);
    case "primary_with_enrichment":
      return dispatchPrimary<T>(req);
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
