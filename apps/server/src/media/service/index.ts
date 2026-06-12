import type { CapabilityScope, LibraryItemQuality } from "@ent-mcp/shared/plugins";
import type { SeasonInfo } from "@ent-mcp/shared/home";
import type { CreateMediaRequestBody, MediaRequest, RequestTarget } from "@ent-mcp/shared/media";
import type { ContinueWatchingEntry } from "@ent-mcp/plugin-sdk";
import { capabilityRegistry } from "../../plugin-runtime";
import type { RawCanonicalSource } from "../../catalog";
import { resolveConnections } from "../internal/resolve-connection";
import type { MatchingServer } from "../types";
import * as aggregateReads from "./aggregate-reads";
import * as homeFeeds from "./home-feeds";
import type { DiscoverFeedFilters, RankedFeedOptions, SimilarFeedInput } from "./home-feeds";
import type { HomeAggregate } from "./interpret-aggregate";
import { LibraryAvailability } from "./library-availability";
import * as metadata from "./metadata";
import * as requests from "./requests";

export { getMatchingServersCached } from "../availability-cache";
export { StatusBatchMemo } from "../status-batch";
export {
  classifyBucket,
  isActiveProgress,
  matchesBucket,
  previewForClassify,
  type PreviewMeta,
  type ProgressEntry,
  type ProgressMap,
} from "../classify";
export {
  enrich,
  enrichCompactItems,
  type EnrichOptions,
  type EnrichResult,
  type CompactMediaEnrichContext,
  type CompactMediaEnrichOptions,
  type CompactMediaEnrichResult,
  type LoadProgressMap,
  type MediaEnrichContext,
  type MediaEnrichRow,
  type MediaProgressSnapshot,
  type WatchlistEnrichContext,
} from "../enrich";
export type { MediaProgressContext } from "../types";

/**
 * Per-user facade. Constructed per-request with the authenticated user id;
 * every method delegates to the responsibility modules in this directory
 * (`./metadata`, `./aggregate-reads`, `./requests`, `./home-feeds`,
 * `./library-availability`), which dispatch through the strategy router, so
 * callers never see the plugin layer directly. Shapes results so the MCP
 * tools and RPC procedures can consume arrays/objects directly.
 */
export class MediaService {
  /** Request-scoped `libraryAvailability@v1` prober with its memo caches. */
  private readonly availability: LibraryAvailability;

  constructor(public readonly userId: string) {
    this.availability = new LibraryAvailability(userId);
  }

  async search(query: string, type?: "movie" | "tv", limit?: number) {
    return metadata.search(this.userId, query, type, limit);
  }

  async trending(type?: "movie" | "tv", limit?: number) {
    return metadata.trending(this.userId, type, limit);
  }

  // fallow-ignore-next-line unused-class-member
  async discover(filters: metadata.DiscoverFilters) {
    return metadata.discover(this.userId, filters);
  }

  async getDetails(
    idOrCombined: string,
    type?: "movie" | "tv",
    opts: { deadlineMs?: number } = {},
  ) {
    return metadata.getDetails(this.userId, idOrCombined, type, opts);
  }

  /** Typed `metadata@v1.getDetails` wrapper — see `./metadata.ts`. */
  async getMetadata(
    tmdbId: string,
    type: "movie" | "tv",
    opts: { deadlineMs?: number } = {},
  ): Promise<RawCanonicalSource | null> {
    return metadata.getMetadata(this.userId, tmdbId, type, opts);
  }

  /** Typed `metadata@v1.getShowSeasons` wrapper — see `./metadata.ts`. */
  async getShowSeasons(
    tmdbId: string,
    opts: { deadlineMs?: number } = {},
  ): Promise<SeasonInfo[] | null> {
    return metadata.getShowSeasons(this.userId, tmdbId, opts);
  }

  /** Aggregate `watchHistory@v1.getHistory` for the catalog mirror sync. */
  async getAllHistory(pluginId?: string): Promise<unknown[]> {
    return aggregateReads.getAllHistory(this.userId, pluginId);
  }

  /** Aggregate `ratings@v1.getRatings` — same shape as `getAllHistory`. */
  async getAllRatings(pluginId?: string): Promise<unknown[]> {
    return aggregateReads.getAllRatings(this.userId, pluginId);
  }

  // fallow-ignore-next-line unused-class-member
  async similar(idOrCombined: string, type?: "movie" | "tv") {
    return metadata.getSimilar(this.userId, idOrCombined, type);
  }

  // fallow-ignore-next-line unused-class-member
  async recommend(limit?: number) {
    return this.getRecommendations(undefined, limit);
  }

  async requestDownload(input: CreateMediaRequestBody): Promise<{ requestId: string | null }> {
    return requests.requestDownload(this.userId, input);
  }

  /** One request-picker entry per (user-connection × downstream target). */
  async listRequestTargets(mediaType: "movie" | "tv"): Promise<RequestTarget[]> {
    return requests.listRequestTargets(this.userId, mediaType);
  }

  async getRequests(): Promise<MediaRequest[]> {
    return requests.getRequests(this.userId);
  }

  async cancelRequest(requestId: string): Promise<void> {
    return requests.cancelRequest(this.userId, requestId);
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
    return aggregateReads.getHistory(this.userId, limit);
  }

  // fallow-ignore-next-line unused-class-member
  async getWatchlist(type?: "movie" | "tv") {
    return aggregateReads.getWatchlist(this.userId, type);
  }

  // fallow-ignore-next-line unused-class-member
  async getUpcoming() {
    return aggregateReads.getUpcoming(this.userId);
  }

  async getRecommendations(type?: "movie" | "tv", limit?: number) {
    return aggregateReads.getRecommendations(this.userId, type, limit);
  }

  /** Aggregate `watchHistory@v1.getInProgress` with home-feed envelope. */
  async getInProgress(
    opts: { limit?: number; deadlineMs?: number } = {},
  ): Promise<HomeAggregate<unknown[]>> {
    return homeFeeds.getInProgress(this.userId, opts);
  }

  /** Coalesced `mediaRequest@v1.getStatusBatch` lookup — see `./requests.ts`. */
  async getStatusBatch(
    ids: ReadonlyArray<string>,
    opts: { deadlineMs?: number } = {},
  ): Promise<Record<string, string>> {
    return requests.getStatusBatch(this.userId, ids, opts);
  }

  /** Cheap watchlist count signal for the layout snapshot. */
  async getWatchlistCount(): Promise<number> {
    return homeFeeds.getWatchlistCount(this.userId);
  }

  /** Count of in-progress shows with at least one upcoming episode. */
  async getCalendarProgressCount(): Promise<number> {
    return homeFeeds.getCalendarProgressCount(this.userId);
  }

  /** Primary `metadata@v1.discover` — used by the `newReleases` row. */
  async discoverFeed(filters: DiscoverFeedFilters): Promise<HomeAggregate<unknown[]>> {
    return homeFeeds.discoverFeed(this.userId, filters);
  }

  /** Primary `metadata@v1.getSimilar` — used by `becauseYouWatched`. */
  // fallow-ignore-next-line unused-class-member
  async getSimilarFeed(input: SimilarFeedInput): Promise<HomeAggregate<unknown[]>> {
    return homeFeeds.getSimilarFeed(this.userId, input);
  }

  /** Aggregate `calendar@v1.getUpcoming` with home-feed envelope. */
  // fallow-ignore-next-line unused-class-member
  async getUpcomingFeed(opts: { deadlineMs?: number } = {}): Promise<HomeAggregate<unknown[]>> {
    return homeFeeds.getUpcomingFeed(this.userId, opts);
  }

  /** Aggregate `watchlist@v1.getWatchlist` with home-feed envelope. */
  // fallow-ignore-next-line unused-class-member
  async getWatchlistFeed(opts: { deadlineMs?: number } = {}): Promise<HomeAggregate<unknown[]>> {
    return homeFeeds.getWatchlistFeed(this.userId, opts);
  }

  /** Aggregate `collection@v1.getCollection` for the owned-library sync. */
  // fallow-ignore-next-line unused-class-member
  async getCollectionFeed(opts: { deadlineMs?: number } = {}): Promise<HomeAggregate<unknown[]>> {
    return homeFeeds.getCollectionFeed(this.userId, opts);
  }

  /** Aggregate `recommendations@v1.getTrending`. */
  // fallow-ignore-next-line unused-class-member
  async getTrendingFeed(opts: RankedFeedOptions): Promise<HomeAggregate<unknown[]>> {
    return homeFeeds.getTrendingFeed(this.userId, opts);
  }

  /** Aggregate `recommendations@v1.getRecommendations` — raw candidates feed. */
  async getRecommendationsFeed(opts: RankedFeedOptions): Promise<HomeAggregate<unknown[]>> {
    return homeFeeds.getRecommendationsFeed(this.userId, opts);
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
      const conns = await resolveConnections(this.userId, pluginId, scope);
      if (conns.length > 0) return true;
    }
    return false;
  }

  /** Aggregate `continueWatching@v1.getContinueWatching` with home-feed envelope. */
  // fallow-ignore-next-line unused-class-member
  async getContinueWatchingFeed(
    opts: { deadlineMs?: number } = {},
  ): Promise<HomeAggregate<ContinueWatchingEntry[]>> {
    return homeFeeds.getContinueWatchingFeed(this.userId, opts);
  }

  /** Memoized per-server availability chips — see `./library-availability.ts`. */
  async getMatchingServers(
    tmdbId: string,
    type: "movie" | "tv",
    opts: { deadlineMs?: number } = {},
  ): Promise<MatchingServer[]> {
    return this.availability.getMatchingServers(tmdbId, type, opts);
  }

  /** Per-copy quality lookup — see `./library-availability.ts`. */
  async getAvailabilityQuality(
    tmdbId: string,
    type: "movie" | "tv",
    opts: { deadlineMs?: number } = {},
  ): Promise<LibraryItemQuality[]> {
    return this.availability.getAvailabilityQuality(tmdbId, type, opts);
  }
}

// Re-exports of public items from service/ and internal/ sub-modules.
export type { DispatchRequest, AggregateResult } from "../types";
export { interpretAggregate, type HomeAggregate } from "./interpret-aggregate";
export {
  dispatch,
  dispatchSingle,
  dispatchAggregate,
  dispatchPrimary,
  dispatchAggregatePerKind,
  invalidateUserCache,
} from "./dispatch";
export { compactFromRaw, type PluginMediaRaw } from "./compact";
export {
  listEligibleConnections,
  dispatchToConnection,
  type EligibleConnection,
  type TargetedDispatchRequest,
} from "./connection-targeted";
export { invokeOne, invokeWithTimeout, harvestFromOutcomes, type InvokeRequest } from "./invoke";
export {
  emitAuthExpired,
  markConnectionStatus,
  persistRefreshedCredentials,
} from "./connection-lifecycle";
export {
  requireCapability,
  scopeForRequest,
  pickSingleConnection,
} from "../internal/capability-lookup";
export { resolveConnections, type ResolvedConnection } from "../internal/resolve-connection";
export {
  identifyItem,
  parseHistoryBase,
  parseItemDate,
  splitCombinedId,
  type RawPluginItem,
  type ItemIdentity,
} from "../internal/parse-item";
export { dispatchAggregatePerKind as dispatchAggregatePerKindStrategy } from "../internal/strategies/aggregate-per-kind";
export {
  setPrimaryConnection,
  clearPrimaryConnection,
  getPrimaryConnection,
} from "./primary-preference";
export {
  listActiveRows,
  listActiveRowsKeyset,
  findRowByKey,
  listAllActiveRows,
  listAvailableCandidates,
  hasActiveRows,
  allKnownKeys,
  upsertActiveRow,
  softRemoveRow,
  bulkInsertActiveRows,
  trySeedLock,
  clearSeedLock,
  hasUserSeeded,
  listSeededUserIds,
  type UpsertActiveResult,
  type SoftRemoveResult,
} from "../repo";
