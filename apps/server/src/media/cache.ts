import { sortBy } from "es-toolkit/array";
import { sha256 } from "../crypto/hash";
import { MemoryCache } from "../cache/memory";
import { RedisCache } from "../cache/redis";
import type { CacheProvider } from "../cache/types";
import { env } from "../env";
import type { CapabilityDefinition, ResolvedCapabilityScope } from "@ent-mcp/plugin-sdk";

/**
 * Canonicalizes a value so the cache key is insensitive to object key order.
 * Returns a sorted-key JSON string.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const unsorted = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== undefined,
  );
  const entries = sortBy(unsorted, [([k]) => k]);
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

export async function argsHash(input: unknown): Promise<string> {
  return (await sha256(canonicalize(input))).slice(0, 16);
}

export interface CacheKeyArgs {
  capability: string;
  version: string;
  method: string;
  userId: string;
  /**
   * Scope the key is written under — resolved per-request by the dispatcher,
   * not derived from a capability-level flag. For mixed-scope capabilities
   * this means a user-scoped resolution (e.g. `idResolve(from: "plex:…")`)
   * lives in a userId-qualified key namespace and cannot be served to a
   * different user out of the global cache.
   */
  scope: ResolvedCapabilityScope;
  input: unknown;
}

export async function cacheKey(args: CacheKeyArgs): Promise<string> {
  const scopeSegment = args.scope === "user" ? `user:${args.userId}` : "global";
  return `mv:${args.capability}:${args.version}:${args.method}:${scopeSegment}:${await argsHash(args.input)}`;
}

export function userScopedPrefix(userId: string): string {
  return `mv:*:*:*:user:${userId}:`;
}

export function capabilityPrefix(capability: string, version: string): string {
  return `mv:${capability}:${version}:`;
}

/**
 * Holds one process-wide cache. Selected by CACHE_BACKEND env with lru as default.
 * Redis connects lazily on first use.
 */
let provider: CacheProvider | undefined;

export function getCacheProvider(): CacheProvider {
  if (provider) return provider;
  if (env.CACHE_PROVIDER === "redis") {
    if (!env.REDIS_URL) throw new Error("CACHE_PROVIDER=redis but REDIS_URL is unset");
    provider = new RedisCache(env.REDIS_URL);
  } else {
    provider = new MemoryCache();
  }
  return provider;
}

export function setCacheProviderForTest(p: CacheProvider): void {
  provider = p;
}

/** Chooses a TTL given the emitted value. Null / empty array → negative-cache TTL. */
export function ttlMsFor(capability: CapabilityDefinition, value: unknown): number {
  const isEmpty =
    value === null ||
    value === undefined ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === "object" &&
      !Array.isArray(value) &&
      value !== null &&
      Object.keys(value as object).length === 0);
  const sec = isEmpty ? capability.negativeCacheTtlSec : capability.defaultCacheTtlSec;
  return sec * 1000;
}
