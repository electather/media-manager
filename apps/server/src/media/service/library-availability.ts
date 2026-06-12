/**
 * Per-request `libraryAvailability@v1` probing backing the MediaService
 * facade. One instance is created per MediaService (request-scoped), so both
 * memo caches share the facade's lifetime.
 */
import type { LibraryItemQuality } from "@ent-mcp/shared/plugins";
import { orderBy, uniqBy } from "es-toolkit/array";
import { capabilityRegistry } from "../../plugin-runtime";
import { requireCapability } from "../internal/capability-lookup";
import { resolveConnections } from "../internal/resolve-connection";
import type { MatchingServer } from "../types";
import { invokeOne } from "./invoke";

/** Per-request library presence index for one `(plugin, type)` pair. */
interface LibraryIndex {
  tmdbIds: Set<string>;
  label: string;
}

export class LibraryAvailability {
  /**
   * Per-request `getMatchingServers` memo keyed by `${tmdbId}|${type}`. Avoids
   * 60× plugin lookups when the same row enriches a 60-item rec list whose
   * items repeatedly hit the same library backends. Cleared with the
   * MediaService instance lifetime (request-scoped).
   */
  private readonly matchingServersCache = new Map<string, Promise<MatchingServer[]>>();

  /**
   * Per-request library presence index keyed by `${pluginId}|${type}`. The
   * first `getMatchingServers` call for a given (plugin, type) triggers a
   * single `libraryAvailability@v1.listAvailable` round-trip that yields the
   * TMDB id set for the user's library. Subsequent calls in the same request
   * are O(1) set lookups, collapsing N enrichment probes to one network call
   * per plugin per request.
   */
  private readonly libraryIndexCache = new Map<string, Promise<LibraryIndex | null>>();

  constructor(private readonly userId: string) {}

  /**
   * Per-server availability lookup for the home-feed `availability.servers`
   * chip strip. Walks every `libraryAvailability@v1` provider for the user;
   * for each plugin, calls `checkAvailability` with `idType: "tmdb"` against
   * the first usable connection. Plugins that report at least one library
   * item are returned as `{ id, label }` chips, deduped by plugin id and
   * sorted by label. Per-request memoized so a 60-item enrichment pass only
   * fans out once per `(tmdbId, type)`.
   *
   * Per-plugin failures are silently dropped — the chip strip is best-effort
   * and a missing chip is preferable to surfacing a transient 5xx in the UI.
   */
  // fallow-ignore-next-line complexity
  async getMatchingServers(
    tmdbId: string,
    type: "movie" | "tv",
    opts: { deadlineMs?: number } = {},
  ): Promise<MatchingServer[]> {
    // Cache key is intentionally deadline-agnostic — first caller's deadline
    // wins for the in-flight probe; later callers get the same promise. Per
    // spec rev 6 invariant: deadline never enters the memo identity.
    const key = `${tmdbId}|${type}`;
    const memo = this.matchingServersCache.get(key);
    if (memo) return memo;
    const promise = this.computeMatchingServers(tmdbId, type, opts.deadlineMs).catch(
      (err: unknown) => {
        this.matchingServersCache.delete(key);
        throw err;
      },
    );
    this.matchingServersCache.set(key, promise);
    return promise;
  }

  /**
   * Per-copy quality lookup across every `libraryAvailability@v1` provider for
   * the user. Unlike `getMatchingServers` — which only needs the chip and so
   * discards `items[].quality` — this returns the raw quality descriptor of
   * every owned copy so the library hydrate job can derive its `qualityTiers`
   * projection (design §Sync + hydrate: "quality ← checkAvailability PER item").
   *
   * This is the N-call fan-out the design flags: one `checkAvailability` per
   * provider per title. It is intended for the background hydrate job, never a
   * request hot path. Per-plugin failures are dropped (best-effort) and an empty
   * array is returned when no provider has the title — a title with no resolvable
   * copies hydrates to empty quality tiers rather than throwing.
   */
  async getAvailabilityQuality(
    tmdbId: string,
    type: "movie" | "tv",
    opts: { deadlineMs?: number } = {},
  ): Promise<LibraryItemQuality[]> {
    const providers = capabilityRegistry.listProviders("libraryAvailability", "v1", "user");
    if (providers.length === 0) return [];
    const capability = requireCapability("libraryAvailability", "v1");
    const queryType = type === "tv" ? "show" : "movie";
    const perProvider = await Promise.all(
      providers.map((pluginId) =>
        this.probeQuality(pluginId, tmdbId, queryType, capability, opts.deadlineMs),
      ),
    );
    return perProvider.flat();
  }

  /**
   * Returns the quality descriptor of every copy of `tmdbId` on `pluginId`, or
   * an empty array when the plugin has no usable connection or the title is
   * absent. Mirrors `probeServerLegacy`'s connection walk but keeps the copies
   * instead of collapsing them to a single chip. A malformed `quality` payload
   * is skipped rather than failing the whole probe.
   */
  // fallow-ignore-next-line complexity
  private async probeQuality(
    pluginId: string,
    tmdbId: string,
    queryType: "movie" | "show",
    capability: ReturnType<typeof requireCapability>,
    deadlineMs: number | undefined,
  ): Promise<LibraryItemQuality[]> {
    // libraryAvailability@v1 is user-scoped: never borrow admin shared creds.
    const conns = await resolveConnections(this.userId, pluginId, "user");
    if (conns.length === 0) return [];
    for (const conn of conns) {
      const outcome = await invokeOne<{ items: { quality?: LibraryItemQuality }[] }>(
        {
          userId: this.userId,
          pluginId,
          capability: "libraryAvailability",
          version: "v1",
          method: "checkAvailability",
          input: { id: tmdbId, idType: "tmdb", type: queryType },
          timeoutMs: capability.defaultTimeoutMs,
          deadlineMs,
        },
        conn,
      );
      if (!outcome.error && Array.isArray(outcome.data?.items) && outcome.data.items.length > 0) {
        return outcome.data.items
          .map((item) => item.quality)
          .filter((quality): quality is LibraryItemQuality => quality != null);
      }
    }
    return [];
  }

  // fallow-ignore-next-line complexity
  private async computeMatchingServers(
    tmdbId: string,
    type: "movie" | "tv",
    deadlineMs: number | undefined,
  ): Promise<MatchingServer[]> {
    const providers = capabilityRegistry.listProviders("libraryAvailability", "v1", "user");
    if (providers.length === 0) return [];
    const capability = requireCapability("libraryAvailability", "v1");
    const queryType = type === "tv" ? "show" : "movie";
    const matches = await Promise.all(
      providers.map(async (pluginId) =>
        this.probeServer(pluginId, tmdbId, queryType, capability, deadlineMs),
      ),
    );
    const found = matches.filter((m): m is MatchingServer => m !== null);
    return orderBy(
      uniqBy(found, (m) => m.id),
      [(m) => m.label.toLowerCase()],
      ["asc"],
    );
  }

  /**
   * Returns a server chip for `pluginId` if `tmdbId` is on its library. Two
   * paths:
   *   • Fast path — `listAvailable` produced an index for this (plugin, type)
   *     in the current request → O(1) set lookup.
   *   • Fallback — index unavailable (plugin doesn't implement it, no
   *     connection, or call errored). Falls back to per-id `checkAvailability`
   *     so the chip still resolves, just at the old per-call cost.
   */
  private async probeServer(
    pluginId: string,
    tmdbId: string,
    queryType: "movie" | "show",
    capability: ReturnType<typeof requireCapability>,
    deadlineMs: number | undefined,
  ): Promise<MatchingServer | null> {
    const index = await this.getLibraryIndex(pluginId, queryType, capability, deadlineMs);
    if (index) {
      return index.tmdbIds.has(tmdbId) ? { id: pluginId, label: index.label } : null;
    }
    return this.probeServerLegacy(pluginId, tmdbId, queryType, capability, deadlineMs);
  }

  // fallow-ignore-next-line complexity
  private async probeServerLegacy(
    pluginId: string,
    tmdbId: string,
    queryType: "movie" | "show",
    capability: ReturnType<typeof requireCapability>,
    deadlineMs: number | undefined,
  ): Promise<MatchingServer | null> {
    // libraryAvailability@v1 is user-scoped: never borrow admin shared creds.
    const conns = await resolveConnections(this.userId, pluginId, "user");
    if (conns.length === 0) return null;
    const entry = capabilityRegistry.get(pluginId);
    const label = entry?.module.manifest.name ?? pluginId;
    for (const conn of conns) {
      const outcome = await invokeOne<{ items: unknown[] }>(
        {
          userId: this.userId,
          pluginId,
          capability: "libraryAvailability",
          version: "v1",
          method: "checkAvailability",
          input: { id: tmdbId, idType: "tmdb", type: queryType },
          timeoutMs: capability.defaultTimeoutMs,
          deadlineMs,
        },
        conn,
      );
      if (!outcome.error && Array.isArray(outcome.data?.items) && outcome.data.items.length > 0) {
        return { id: pluginId, label };
      }
    }
    return null;
  }

  /**
   * Memoised one-shot library index for `(pluginId, queryType)`. Returns
   * `null` when the plugin has no usable connection or the dispatch failed —
   * callers fall back to per-id `checkAvailability`. The promise is cached
   * even on rejection-style nulls so a second item lookup in the same request
   * does not re-probe a plugin that just failed.
   *
   * Cache identity is intentionally deadline-agnostic (mirrors
   * `getMatchingServers`): the first caller's `deadlineMs` governs the shared
   * probe; a later caller with a tighter deadline silently inherits the
   * looser one. Safe today because every `MediaService` instance is scoped to
   * one HTTP request or one warm-job row. If that invariant ever changes —
   * a `MediaService` shared across requests with differing deadlines — the
   * tighter deadline will be ignored. Add `deadlineMs` to `key` only if that
   * happens.
   */
  // fallow-ignore-next-line complexity
  private async getLibraryIndex(
    pluginId: string,
    queryType: "movie" | "show",
    capability: ReturnType<typeof requireCapability>,
    deadlineMs: number | undefined,
  ): Promise<LibraryIndex | null> {
    const key = `${pluginId}|${queryType}`;
    const memo = this.libraryIndexCache.get(key);
    if (memo) return memo;
    const promise = this.computeLibraryIndex(pluginId, queryType, capability, deadlineMs).catch(
      (err: unknown) => {
        this.libraryIndexCache.delete(key);
        throw err;
      },
    );
    this.libraryIndexCache.set(key, promise);
    return promise.catch(() => null);
  }

  // fallow-ignore-next-line complexity
  private async computeLibraryIndex(
    pluginId: string,
    queryType: "movie" | "show",
    capability: ReturnType<typeof requireCapability>,
    deadlineMs: number | undefined,
  ): Promise<LibraryIndex | null> {
    // libraryAvailability@v1 is user-scoped: never borrow admin shared creds.
    const conns = await resolveConnections(this.userId, pluginId, "user");
    if (conns.length === 0) return null;
    const entry = capabilityRegistry.get(pluginId);
    const label = entry?.module.manifest.name ?? pluginId;
    for (const conn of conns) {
      const outcome = await invokeOne<{ tmdbIds: string[] }>(
        {
          userId: this.userId,
          pluginId,
          capability: "libraryAvailability",
          version: "v1",
          method: "listAvailable",
          input: { type: queryType },
          timeoutMs: capability.defaultTimeoutMs,
          deadlineMs,
        },
        conn,
      );
      if (!outcome.error && Array.isArray(outcome.data?.tmdbIds)) {
        return { tmdbIds: new Set(outcome.data.tmdbIds), label };
      }
    }
    return null;
  }
}
