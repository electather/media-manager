/**
 * Per-request `libraryAvailability@v1` probing backing the MediaService
 * facade. One instance is created per MediaService (request-scoped), so both
 * memo caches share the facade's lifetime.
 */
import type { LibraryItemQuality } from "@nama/shared/plugins";
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
  /** Per-request memo for getMatchingServers (key: `${tmdbId}|${type}`). Collapses N identical probes to one lookup per request. */
  private readonly matchingServersCache = new Map<string, Promise<MatchingServer[]>>();

  /** Per-request library index (key: `${pluginId}|${type}`). First call triggers one `listAvailable` RPC; subsequent calls are O(1) set lookups. */
  private readonly libraryIndexCache = new Map<string, Promise<LibraryIndex | null>>();

  constructor(private readonly userId: string) {}

  /**
   * Per-server availability for home-feed chip strip. Walks every `libraryAvailability@v1` provider,
   * calling `checkAvailability(idType: "tmdb")` on the first usable connection per plugin. Returns
   * deduped `{ id, label }` chips sorted by label, memoized per `(tmdbId, type)`. Per-plugin failures
   * are silently dropped (best-effort; missing chip > transient 5xx in UI).
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
   * Per-copy quality lookup for every `libraryAvailability@v1` provider. Unlike getMatchingServers,
   * returns raw quality descriptors so the hydrate job can derive `qualityTiers` (design §Sync:
   * "quality ← checkAvailability PER item"). One call per provider per title (flagged N-call fan-out,
   * background only, never hot path). Per-plugin failures dropped; no copies → empty array.
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

  /** Quality descriptors for every copy of tmdbId on pluginId, or empty array if unavailable. Like probeServerLegacy but keeps all copies (not collapsed to one chip). Malformed quality is skipped. */
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

  /** Server chip for pluginId if tmdbId is in its library. Fast path: O(1) set lookup via index. Fallback: per-id checkAvailability if index unavailable. */
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
   * Memoized one-shot index for `(pluginId, queryType)`. Cached even on null (failed dispatch)
   * so second lookup doesn't re-probe. Cache key is deadline-agnostic: first caller's deadline
   * wins for the shared probe. Safe today (MediaService scoped to one HTTP request), but if
   * shared across requests with differing deadlines, tighter deadline gets ignored — add
   * deadlineMs to key then.
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
