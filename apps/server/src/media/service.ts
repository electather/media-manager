import {
  dispatchAggregate,
  dispatchPrimary,
  dispatchSingle,
  type AggregateResult,
} from "./dispatcher";
import type { CapabilityScope } from "@ent-mcp/shared/plugins";
import type { SeasonInfo } from "@ent-mcp/shared/home";
import {
  mediaRequestSchema,
  type CreateMediaRequestBody,
  type MediaRequest,
  type RequestTarget,
} from "@ent-mcp/shared/media";
import { z } from "zod";
import type { ContinueWatchingEntry } from "@ent-mcp/plugin-sdk";
import { capabilityRegistry } from "../plugin-runtime/registry";
import { AllPluginsFailedError, PluginCallError } from "./errors";
import { HttpError, badRequest } from "../errors/http-errors";
import type { RawCanonicalSource } from "../catalog/canonical";
import { resolveConnections } from "./resolve-connection";
import { invokeOne } from "./invoke";
import { requireCapability } from "./capability-lookup";
import { dispatchToConnection, listEligibleConnections } from "./connection-targeted";
import { decodeServiceId, encodeServiceId, TARGET_ID_RE } from "./service-id";
import { isNil } from "es-toolkit/predicate";
import { orderBy, uniqBy } from "es-toolkit/array";

interface ListTargetsOutput {
  targets: Array<{
    targetId: string;
    label: string;
    exposesProfiles: boolean;
    defaultProfileId: string | null;
    profiles: Array<{ id: string; label: string; detail?: string }>;
  }>;
}

interface CreateRequestOutput {
  success: boolean;
  requestId?: string;
  message?: string;
}

/**
 * Per-user facade. Constructed per-request with the authenticated user id;
 * every method dispatches through the strategy router, so callers never see
 * the plugin layer directly. Shapes results so the MCP tools and RPC
 * procedures can consume arrays/objects directly.
 */
function parseCombinedId(idOrCombined: string, type?: "movie" | "tv"): ["movie" | "tv", string] {
  if (isNil(type) && idOrCombined.includes(":")) {
    return idOrCombined.split(":") as ["movie" | "tv", string];
  }
  return [type ?? "movie", idOrCombined];
}

export class MediaService {
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

  constructor(public readonly userId: string) {}

  // fallow-ignore-next-line unused-class-member
  async search(query: string, type?: "movie" | "tv", limit?: number) {
    const result = await dispatchPrimary<Array<{ item: unknown; score?: number }>>({
      userId: this.userId,
      capability: "metadata",
      version: "v1",
      method: "search",
      input: { query, type, limit },
      mediaType: type,
    });
    return result.data ?? [];
  }

  // fallow-ignore-next-line unused-class-member
  async trending(type?: "movie" | "tv", limit?: number) {
    const result = await dispatchPrimary<unknown[]>({
      userId: this.userId,
      capability: "metadata",
      version: "v1",
      method: "getTrending",
      input: { type, limit },
      mediaType: type,
    });
    return result.data ?? [];
  }

  // fallow-ignore-next-line unused-class-member
  async discover(filters: {
    genres?: string[];
    yearMin?: number;
    yearMax?: number;
    ratingMin?: number;
    limit?: number;
  }) {
    const result = await dispatchPrimary<unknown[]>({
      userId: this.userId,
      capability: "metadata",
      version: "v1",
      method: "discover",
      input: filters,
    });
    return result.data ?? [];
  }

  async getDetails(idOrCombined: string, type?: "movie" | "tv") {
    const [parsedType, parsedId] = parseCombinedId(idOrCombined, type);
    const result = await dispatchPrimary<unknown>({
      userId: this.userId,
      capability: "metadata",
      version: "v1",
      method: "getDetails",
      input: { id: parsedId, type: parsedType },
      mediaType: parsedType,
    });
    return result.data ?? null;
  }

  /**
   * Typed `metadata@v1.getDetails` wrapper used by the catalog cold-fill
   * provider and the nightly metadata-refresh job. Returns `null` when no
   * primary plugin is available or the dispatch yields no data — callers
   * fall back to other paths in that case rather than throwing.
   */
  async getMetadata(tmdbId: string, type: "movie" | "tv"): Promise<RawCanonicalSource | null> {
    const result = await dispatchPrimary<RawCanonicalSource>({
      userId: this.userId,
      capability: "metadata",
      version: "v1",
      method: "getDetails",
      input: { id: tmdbId, type },
      mediaType: type,
    });
    return result.data ?? null;
  }

  /**
   * Typed `metadata@v1.getShowSeasons` wrapper used by the home-feed detail
   * composer. Returns `null` when no primary plugin is available, the dispatch
   * yields no data, or the payload is malformed — the orchestrator omits the
   * field rather than failing the detail call so movies and shows w/o season
   * payloads still render the rest of the response.
   */
  async getShowSeasons(tmdbId: string): Promise<SeasonInfo[] | null> {
    try {
      const result = await dispatchPrimary<{ seasons?: SeasonInfo[] }>({
        userId: this.userId,
        capability: "metadata",
        version: "v1",
        method: "getShowSeasons",
        input: { id: tmdbId },
        mediaType: "tv",
      });
      const seasons = result.data?.seasons;
      return Array.isArray(seasons) ? seasons : null;
    } catch {
      return null;
    }
  }

  /**
   * Aggregate `watchHistory@v1.getHistory` for the catalog mirror sync.
   * The optional `pluginId` narrows the dispatch to a single plugin so the
   * per-connection cursor advancement stays accurate when a user has
   * multiple history-emitting plugins. The dispatcher itself has no
   * `connectionId` filter; callers that need finer-grained narrowing run
   * one mirror-sync row per `(userId, pluginId)` and tag events with the
   * connection identity at the application layer.
   */
  async getAllHistory(pluginId?: string): Promise<unknown[]> {
    const result = await dispatchAggregate<unknown[]>({
      userId: this.userId,
      capability: "watchHistory",
      version: "v1",
      method: "getHistory",
      input: {},
      ...(pluginId ? { pluginId } : {}),
    });
    return result.data ?? [];
  }

  /** Aggregate `ratings@v1.getRatings` — same shape as `getAllHistory`. */
  async getAllRatings(pluginId?: string): Promise<unknown[]> {
    const result = await dispatchAggregate<unknown[]>({
      userId: this.userId,
      capability: "ratings",
      version: "v1",
      method: "getRatings",
      input: {},
      ...(pluginId ? { pluginId } : {}),
    });
    return result.data ?? [];
  }

  // fallow-ignore-next-line unused-class-member
  async similar(idOrCombined: string, type?: "movie" | "tv") {
    const [parsedType, parsedId] = parseCombinedId(idOrCombined, type);
    const result = await dispatchPrimary<unknown[]>({
      userId: this.userId,
      capability: "metadata",
      version: "v1",
      method: "getSimilar",
      input: { id: parsedId, type: parsedType },
      mediaType: parsedType,
    });
    return result.data ?? [];
  }

  // fallow-ignore-next-line unused-class-member
  async recommend(limit?: number) {
    return this.getRecommendations(undefined, limit);
  }

  // fallow-ignore-next-line complexity
  async requestDownload(input: CreateMediaRequestBody): Promise<{ requestId: string | null }> {
    const decoded = decodeServiceId(input.serviceId);
    if (!decoded) throw badRequest("request.invalid_input", "malformed serviceId");
    const { connectionId, targetId } = decoded;

    if (input.mediaType === "movie" && input.seasons?.length) {
      console.warn("[mediaService] seasons ignored for movie request", {
        tmdbId: input.tmdbId,
      });
    }
    const seasonsCsv =
      input.mediaType === "tv" && input.seasons?.length ? input.seasons.join(",") : undefined;

    let result: CreateRequestOutput | null;
    try {
      result = await dispatchToConnection<CreateRequestOutput>({
        userId: this.userId,
        connectionId,
        capability: "mediaRequest",
        version: "v1",
        method: "createRequest",
        input: {
          tmdbId: input.tmdbId,
          type: input.mediaType,
          seasons: seasonsCsv,
          targetId,
          ...(input.profileId ? { profileId: input.profileId } : {}),
        },
      });
    } catch (err) {
      if (err instanceof PluginCallError) {
        if (err.code === "mcp.target_not_found") {
          throw new HttpError(404, "request.unknown_service", "service not found");
        }
        if (
          err.code === "plugin.input_invalid" ||
          err.code === "plugin.upstream_error" ||
          err.code === "plugin.timeout"
        ) {
          throw new HttpError(502, "request.provider_failed", err.message);
        }
      }
      throw err;
    }

    if (!result || !result.success) {
      throw new HttpError(502, "request.provider_failed", result?.message ?? "provider failed");
    }
    return { requestId: result.requestId ?? null };
  }

  /**
   * Aggregates one entry per (user-connection × downstream target) for the
   * request picker. Per-connection failures are logged and skipped so a single
   * broken Seerr instance does not blank the whole picker; targets whose
   * `targetId` violates `TARGET_ID_RE` are dropped per-entry.
   */
  // fallow-ignore-next-line complexity
  async listRequestTargets(mediaType: "movie" | "tv"): Promise<RequestTarget[]> {
    const eligible = await listEligibleConnections(this.userId, "mediaRequest", "v1");
    // Fan out per connection in parallel — one slow Seerr instance otherwise
    // blocks the picker waiting on every other connection's response. Failures
    // are logged and skipped per-connection so a single broken instance does
    // not blank the whole picker.
    const settled = await Promise.allSettled(
      eligible.map((c) =>
        dispatchToConnection<ListTargetsOutput>({
          userId: this.userId,
          connectionId: c.connectionId,
          capability: "mediaRequest",
          version: "v1",
          method: "listTargets",
          input: { type: mediaType },
        }),
      ),
    );

    const out: RequestTarget[] = [];
    for (const [i, settledResult] of settled.entries()) {
      const c = eligible[i]!;
      if (settledResult.status === "rejected") {
        const err = settledResult.reason as unknown;
        console.warn("[mediaService] listTargets failed", {
          pluginId: c.pluginId,
          connectionId: c.connectionId,
          err: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      const result = settledResult.value;
      if (!result) continue;
      for (const t of result.targets) {
        if (!TARGET_ID_RE.test(t.targetId)) {
          console.warn("[mediaService] invalid targetId, skipping", {
            pluginId: c.pluginId,
            targetId: t.targetId,
          });
          continue;
        }
        out.push({
          serviceId: encodeServiceId(c.connectionId, t.targetId),
          pluginId: c.pluginId,
          label: t.label,
          exposesProfiles: t.exposesProfiles,
          defaultProfileId: t.defaultProfileId,
          profiles: t.profiles,
        });
      }
    }
    return out;
  }

  // fallow-ignore-next-line unused-class-member
  async getRequests(): Promise<MediaRequest[]> {
    const result = await dispatchSingle<unknown[]>({
      userId: this.userId,
      capability: "mediaRequest",
      version: "v1",
      method: "listRequests",
      input: {},
    });
    return z.array(mediaRequestSchema).parse(result ?? []);
  }

  async cancelRequest(requestId: string): Promise<void> {
    let result: { ok: boolean; message?: string } | null;
    try {
      result = await dispatchSingle<{ ok: boolean; message?: string }>({
        userId: this.userId,
        capability: "mediaRequest",
        version: "v1",
        method: "cancelRequest",
        input: { requestId },
      });
    } catch (err) {
      if (err instanceof PluginCallError) {
        if (err.code === "mcp.target_not_found") {
          throw new HttpError(404, "request.unknown_service", "service not found");
        }
        if (
          err.code === "plugin.input_invalid" ||
          err.code === "plugin.upstream_error" ||
          err.code === "plugin.timeout"
        ) {
          throw new HttpError(502, "request.provider_failed", err.message);
        }
      }
      throw err;
    }
    if (!result?.ok) {
      throw new HttpError(502, "request.provider_failed", result?.message ?? "provider failed");
    }
  }

  // fallow-ignore-next-line unused-class-member
  async getProgress(): Promise<unknown[]> {
    // Progress is derived from watchHistory + metadata at the host layer; no
    // plugin capability covers it in v1. Returning empty keeps the MCP tool
    // happy until a dedicated capability (or host-side aggregator) lands.
    return [];
  }

  // fallow-ignore-next-line unused-class-member
  async recordFeedback(
    _id: string,
    _action: "like" | "dislike" | "rate" | "note",
    _rating?: number,
    _note?: string,
  ): Promise<void> {
    // Feedback is a host-owned concern (preference profiles, feedback_log).
    // The plugin layer does not mediate it, so this is a no-op for now.
  }

  // fallow-ignore-next-line unused-class-member
  async getHistory(limit?: number) {
    const result = await dispatchAggregate<unknown[]>({
      userId: this.userId,
      capability: "watchHistory",
      version: "v1",
      method: "getHistory",
      input: { limit },
    });
    return result.data ?? [];
  }

  // fallow-ignore-next-line unused-class-member
  async getWatchlist(type?: "movie" | "tv") {
    const result = await dispatchAggregate<unknown[]>({
      userId: this.userId,
      capability: "watchlist",
      version: "v1",
      method: "getWatchlist",
      input: { type },
    });
    return result.data ?? [];
  }

  // fallow-ignore-next-line unused-class-member
  async getUpcoming() {
    const result = await dispatchAggregate<unknown[]>({
      userId: this.userId,
      capability: "calendar",
      version: "v1",
      method: "getUpcoming",
      input: {},
    });
    return result.data ?? [];
  }

  async getRecommendations(type?: "movie" | "tv", limit?: number) {
    const result = await dispatchAggregate<unknown[]>({
      userId: this.userId,
      capability: "recommendations",
      version: "v1",
      method: "getRecommendations",
      input: { type, limit },
    });
    return result.data ?? [];
  }

  /**
   * Result envelope returned by every aggregate-style helper used by the home
   * feed. `partial` mirrors the design's `partial: true` row signal; `allFailed`
   * is true only when at least one provider was attempted and every one of
   * them errored — distinct from "no providers installed" (allFailed=false,
   * data empty) and from "every provider succeeded with nothing to show"
   * (partial=false, data empty).
   */
  // (Type lives at module scope below — kept here as a doc pointer.)

  /**
   * Aggregate `watchHistory@v1.getInProgress`. Plugins that do not implement
   * the method are skipped at the dispatcher layer; if any of the surviving
   * providers return data the row renders, with `partial: true` set when at
   * least one peer errored. Throws `AllPluginsFailedError` only when every
   * resolved provider errored, so the row can be flagged `all_failed`.
   */
  async getInProgress(
    opts: { limit?: number; deadlineMs?: number } = {},
  ): Promise<HomeAggregate<unknown[]>> {
    const result = await dispatchAggregate<unknown[]>({
      userId: this.userId,
      capability: "watchHistory",
      version: "v1",
      method: "getInProgress",
      input: { limit: opts.limit },
      deadlineMs: opts.deadlineMs,
    });
    return interpretAggregate("watchHistory@v1", result);
  }

  /**
   * Coalesced batch availability lookup. `mediaRequest@v1` is a `single`
   * strategy capability, so one plugin owns the response. Failures resolve
   * to an empty map — callers (today: the home feed dataloader) fall back to
   * `status: "unknown"` per item.
   */
  // fallow-ignore-next-line complexity
  async getStatusBatch(ids: ReadonlyArray<string>): Promise<Record<string, string>> {
    if (ids.length === 0) return {};
    try {
      const result = await dispatchSingle<{ statuses: Record<string, string> }>({
        userId: this.userId,
        capability: "mediaRequest",
        version: "v1",
        method: "getStatusBatch",
        input: { ids: [...ids] },
      });
      return result?.statuses ?? {};
    } catch (err) {
      if (err instanceof PluginCallError) return {};
      throw err;
    }
  }

  /**
   * Cheap count signal for the layout snapshot. Reads through the
   * `watchlist@v1` aggregate cache; on full failure returns zero so the home
   * feed can drop the row without surfacing the underlying plugin error.
   */
  async getWatchlistCount(): Promise<number> {
    try {
      const result = await dispatchAggregate<unknown[]>({
        userId: this.userId,
        capability: "watchlist",
        version: "v1",
        method: "getWatchlist",
        input: {},
      });
      return Array.isArray(result.data) ? result.data.length : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Count of in-progress shows that have at least one upcoming episode. The
   * home feed uses this as a layout-time gate for `upcomingForYou`; if the
   * underlying calendar cache is cold the layout falls back to dropping the
   * row this snapshot, so failures here resolve to zero.
   */
  // fallow-ignore-next-line complexity
  async getCalendarProgressCount(): Promise<number> {
    try {
      const [inProgress, upcoming] = await Promise.all([
        this.getInProgress(),
        dispatchAggregate<unknown[]>({
          userId: this.userId,
          capability: "calendar",
          version: "v1",
          method: "getUpcoming",
          input: {},
        }),
      ]);
      const upcomingShows = new Set<string>();
      for (const entry of upcoming.data ?? []) {
        const tmdbId = readTmdbId(entry);
        if (tmdbId) upcomingShows.add(tmdbId);
      }
      let count = 0;
      for (const item of inProgress.items) {
        const tmdbId = readNestedTmdbId(item);
        if (tmdbId && upcomingShows.has(tmdbId)) count += 1;
      }
      return count;
    } catch {
      return 0;
    }
  }

  /** Primary `metadata@v1.discover` — used by the `newReleases` row. */
  async discoverFeed(filters: {
    genres?: string[];
    yearMin?: number;
    yearMax?: number;
    ratingMin?: number;
    limit?: number;
    releaseDateGte?: number;
    releaseDateLte?: number;
    sort?: "popularity_desc" | "popularity_asc" | "release_date_desc" | "release_date_asc";
    deadlineMs?: number;
  }): Promise<HomeAggregate<unknown[]>> {
    const { deadlineMs, ...input } = filters;
    const result = await dispatchPrimary<unknown[]>({
      userId: this.userId,
      capability: "metadata",
      version: "v1",
      method: "discover",
      input,
      deadlineMs,
    });
    return interpretAggregate("metadata@v1", result);
  }

  /**
   * Primary `metadata@v1.getSimilar` — used by `becauseYouWatched` keyed on
   * the cursor-pinned seed media id.
   */
  // fallow-ignore-next-line unused-class-member
  async getSimilarFeed(input: {
    id: string;
    type: "movie" | "tv";
    deadlineMs?: number;
  }): Promise<HomeAggregate<unknown[]>> {
    const { deadlineMs, ...rest } = input;
    const result = await dispatchPrimary<unknown[]>({
      userId: this.userId,
      capability: "metadata",
      version: "v1",
      method: "getSimilar",
      input: rest,
      mediaType: rest.type,
      deadlineMs,
    });
    return interpretAggregate("metadata@v1", result);
  }

  /**
   * Aggregate `calendar@v1.getUpcoming`. Distinct from the legacy
   * `getUpcoming` getter on this class: this variant surfaces a `partial`
   * flag and an `AllPluginsFailedError` so the home feed orchestrator can
   * classify the row outcome correctly.
   */
  // fallow-ignore-next-line unused-class-member
  async getUpcomingFeed(opts: { deadlineMs?: number } = {}): Promise<HomeAggregate<unknown[]>> {
    const result = await dispatchAggregate<unknown[]>({
      userId: this.userId,
      capability: "calendar",
      version: "v1",
      method: "getUpcoming",
      input: {},
      deadlineMs: opts.deadlineMs,
    });
    return interpretAggregate("calendar@v1", result);
  }

  /**
   * Aggregate `watchlist@v1.getWatchlist` for the home-feed `yourWatchlist`
   * row. Surfaces partial-failure signalling that the legacy `getWatchlist`
   * getter swallows.
   */
  // fallow-ignore-next-line unused-class-member
  async getWatchlistFeed(opts: { deadlineMs?: number } = {}): Promise<HomeAggregate<unknown[]>> {
    const result = await dispatchAggregate<unknown[]>({
      userId: this.userId,
      capability: "watchlist",
      version: "v1",
      method: "getWatchlist",
      input: {},
      deadlineMs: opts.deadlineMs,
    });
    return interpretAggregate("watchlist@v1", result);
  }

  /** Aggregate `recommendations@v1.getTrending`. */
  // fallow-ignore-next-line unused-class-member
  async getTrendingFeed(opts: {
    mediaType?: "movie" | "tv";
    limit?: number;
    deadlineMs?: number;
  }): Promise<HomeAggregate<unknown[]>> {
    const result = await dispatchAggregate<unknown[]>({
      userId: this.userId,
      capability: "recommendations",
      version: "v1",
      method: "getTrending",
      input: { type: opts.mediaType, limit: opts.limit },
      deadlineMs: opts.deadlineMs,
    });
    return interpretAggregate("recommendations@v1", result);
  }

  /** Aggregate `recommendations@v1.getRecommendations` — raw candidates feed. */
  async getRecommendationsFeed(opts: {
    mediaType?: "movie" | "tv";
    limit?: number;
    deadlineMs?: number;
  }): Promise<HomeAggregate<unknown[]>> {
    const result = await dispatchAggregate<unknown[]>({
      userId: this.userId,
      capability: "recommendations",
      version: "v1",
      method: "getRecommendations",
      input: { type: opts.mediaType, limit: opts.limit },
      deadlineMs: opts.deadlineMs,
    });
    return interpretAggregate("recommendations@v1", result);
  }

  /**
   * Returns true when at least one enabled provider for `capability@version`
   * is reachable for this user. Cheap presence check the home feed snapshot
   * uses to gate row eligibility before any plugin call. Walks the registry
   * for providers, then `resolveConnections` for the first plugin that has
   * a usable connection — short-circuits on first match.
   */
  async hasCapabilityProvider(
    capability: string,
    version: string,
    scope: CapabilityScope = "user",
  ): Promise<boolean> {
    const providers = capabilityRegistry.listProviders(capability, version, scope);
    for (const pluginId of providers) {
      const conns = await resolveConnections(this.userId, pluginId);
      if (conns.length > 0) return true;
    }
    return false;
  }

  /**
   * Aggregate `continueWatching@v1.getContinueWatching`. Mirrors the
   * `getWatchlistFeed` pattern — surfaces a `partial` flag plus throws
   * `AllPluginsFailedError` when every attempted provider errors so the home
   * orchestrator can flag the row outcome. Used by the
   * `continueWatching-active`, `continueWatching-next`, and hero cascade.
   */
  // fallow-ignore-next-line unused-class-member
  async getContinueWatchingFeed(
    opts: { deadlineMs?: number } = {},
  ): Promise<HomeAggregate<ContinueWatchingEntry[]>> {
    const result = await dispatchAggregate<ContinueWatchingEntry[]>({
      userId: this.userId,
      capability: "continueWatching",
      version: "v1",
      method: "getContinueWatching",
      input: {},
      deadlineMs: opts.deadlineMs,
    });
    return interpretAggregate("continueWatching@v1", result);
  }

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
  async getMatchingServers(tmdbId: string, type: "movie" | "tv"): Promise<MatchingServer[]> {
    const key = `${tmdbId}|${type}`;
    const memo = this.matchingServersCache.get(key);
    if (memo) return memo;
    // Drop the cache entry on rejection — `requireCapability` may throw if
    // `libraryAvailability@v1` isn't registered, and a sticky rejected promise
    // would re-throw on every subsequent call for the lifetime of the request.
    const promise = this.computeMatchingServers(tmdbId, type).catch((err: unknown) => {
      this.matchingServersCache.delete(key);
      throw err;
    });
    this.matchingServersCache.set(key, promise);
    return promise;
  }

  // fallow-ignore-next-line complexity
  private async computeMatchingServers(
    tmdbId: string,
    type: "movie" | "tv",
  ): Promise<MatchingServer[]> {
    const providers = capabilityRegistry.listProviders("libraryAvailability", "v1", "user");
    if (providers.length === 0) return [];
    const capability = requireCapability("libraryAvailability", "v1");
    const queryType = type === "tv" ? "show" : "movie";
    const matches = await Promise.all(
      providers.map(async (pluginId) => this.probeServer(pluginId, tmdbId, queryType, capability)),
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
  ): Promise<MatchingServer | null> {
    const index = await this.getLibraryIndex(pluginId, queryType, capability);
    if (index) {
      return index.tmdbIds.has(tmdbId) ? { id: pluginId, label: index.label } : null;
    }
    return this.probeServerLegacy(pluginId, tmdbId, queryType, capability);
  }

  private async probeServerLegacy(
    pluginId: string,
    tmdbId: string,
    queryType: "movie" | "show",
    capability: ReturnType<typeof requireCapability>,
  ): Promise<MatchingServer | null> {
    const conns = await resolveConnections(this.userId, pluginId);
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
   */
  // fallow-ignore-next-line complexity
  private async getLibraryIndex(
    pluginId: string,
    queryType: "movie" | "show",
    capability: ReturnType<typeof requireCapability>,
  ): Promise<LibraryIndex | null> {
    const key = `${pluginId}|${queryType}`;
    const memo = this.libraryIndexCache.get(key);
    if (memo) return memo;
    // Drop the cache entry on rejection so a transient
    // `resolveConnections` race does not stick a null index for the lifetime
    // of the request. The promise itself still resolves to `null` (callers
    // fall through to the per-id legacy probe) — eviction only affects what
    // the *next* lookup sees.
    const promise = this.computeLibraryIndex(pluginId, queryType, capability).catch(
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
  ): Promise<LibraryIndex | null> {
    const conns = await resolveConnections(this.userId, pluginId);
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

/** Per-request library presence index for one `(plugin, type)` pair. */
interface LibraryIndex {
  tmdbIds: Set<string>;
  label: string;
}

/** Plugin chip displayed under `CompactMediaItem.availability.servers`. */
export interface MatchingServer {
  id: string;
  label: string;
}

/**
 * Result envelope returned by every aggregate-style helper used by the home
 * feed. `partial` mirrors the design's `partial: true` row signal.
 */
export interface HomeAggregate<T extends unknown[]> {
  items: T;
  partial: boolean;
}

/**
 * Translates a raw `AggregateResult` into the home-feed `HomeAggregate`
 * envelope and decides whether the row should be flagged `all_failed`.
 *
 * Three distinct outcomes share the surface:
 *   - `attempted === 0` — no providers installed. Returns empty, partial=false;
 *     row drops normally (no `partial: true` because there is no error to
 *     surface).
 *   - `errors.length === attempted && attempted > 0` — every provider errored.
 *     Throws `AllPluginsFailedError` so the orchestrator marks the row
 *     `all_failed` rather than letting `upcomingForYou`'s ok_empty exemption
 *     fire on a calendar plugin outage.
 *   - else — at least one provider succeeded. Returns whatever data was
 *     collected, with `partial: true` when at least one peer errored.
 */
// fallow-ignore-next-line complexity
export function interpretAggregate<T>(
  capabilityKey: string,
  result: AggregateResult<T[]>,
): HomeAggregate<T[]> {
  const data = (result.data ?? []) as T[];
  const errors = result.errors ?? [];
  const attempted = result.attempted ?? 0;
  if (attempted > 0 && errors.length === attempted) {
    throw new AllPluginsFailedError(
      capabilityKey,
      errors.map((e) => ({ pluginId: e.pluginId, code: e.code, devMessage: e.devMessage })),
    );
  }
  return { items: data, partial: errors.length > 0 };
}

/**
 * Best-effort lookup of a `tmdbId` field on aggregate calendar entries. The
 * shape is deliberately untyped at the dispatcher boundary — different
 * calendar plugins surface it under `item.ids.tmdb_id`, `tmdbId`, or `id`.
 */
// fallow-ignore-next-line complexity
function readTmdbId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const flat = typeof v.tmdbId === "string" ? v.tmdbId : null;
  if (flat) return flat;
  const item = v.item as Record<string, unknown> | undefined;
  if (!item) return null;
  const ids = item.ids as Record<string, unknown> | undefined;
  const tmdb = ids?.tmdb_id;
  if (typeof tmdb === "string") return tmdb;
  const id = item.id;
  if (typeof id === "string" && id.includes(":")) return id.split(":")[1] ?? null;
  return null;
}

function readNestedTmdbId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const item = (value as { item?: unknown }).item;
  return readTmdbId({ item });
}
