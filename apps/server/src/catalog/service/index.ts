import { getDb, type Db } from "../../db/client";
import type {
  CanonicalMetadata,
  CanonicalMetadataWithIds,
  DiscoverFeedKind,
  DiscoverSort,
  HistoryEvent,
  MetadataKey,
  PluginCursors,
  RatingEvent,
  RecItem,
  RecommendationList,
  RecommendationListKind,
} from "@nama/shared/catalog";
import { PerUserMutex } from "../internal/mutex";
import { recordMetadataAccess } from "./access-throttle";
import { discoverFeedExists, selectDiscoverFeed, upsertDiscoverSnapshot } from "./discover-feed";
import {
  selectMetadata,
  selectMetadataBatch,
  selectMetadataWithIds,
  selectStaleMetadataKeys,
} from "./metadata-reads";
import { patchArtworkUrls, upsertMetadata } from "./metadata-writes";
import { deleteOldDiscoverSnapshots, pruneUnusedMetadataRows } from "./prune";
import { selectRecommendations, upsertRecommendationList } from "./recommendations";
import {
  appendHistoryEvents,
  appendRatingEvents,
  type MirrorStore,
  selectHistoryCursors,
  selectRatingsCursors,
  selectUserHistory,
  selectUserIdsSyncedSince,
  selectUserRatings,
} from "./user-mirrors";

const DEFAULT_RECORD_ACCESS_THROTTLE_MS = 60 * 60 * 1000;

/**
 * UTC midnight epoch ms — keys the day-bucketed `discover_snapshots` table.
 * Replicated here (it also lives in the home discover source) so the catalog
 * stays a lower-level module and does not import from `home`, which would
 * invert the dependency direction.
 */
function utcDayBucket(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

interface CatalogServiceOptions {
  recordAccessThrottleMs?: number;
}

/**
 * Catalog peer of MediaService. Sole owner of the canonical_metadata,
 * discover_snapshots, recommendation_lists, user_history_mirror and
 * user_ratings_mirror tables (V37). Reads serve sub-ms PK lookups; writes
 * are jobs-only except bounded cold-fill from the preference engine (V38).
 *
 * The class is a thin facade over the sibling responsibility modules
 * (metadata reads/writes, discover feed, recommendations, user mirrors,
 * access throttle, prune); it owns the per-process state they share.
 */
export class CatalogService {
  readonly recordAccessThrottleMs: number;

  private readonly db: Db;
  private readonly mirrorMutex = new PerUserMutex();
  // In-process throttle keyed by `${type}:${tmdbId}`. Each entry is the
  // last-seen monotonic timestamp; a fresh `recordAccess` only enqueues
  // the row for an UPDATE if `now - prior >= recordAccessThrottleMs`.
  private readonly accessThrottle = new Map<string, number>();

  constructor(db: Db, opts: CatalogServiceOptions = {}) {
    this.db = db;
    this.recordAccessThrottleMs = opts.recordAccessThrottleMs ?? DEFAULT_RECORD_ACCESS_THROTTLE_MS;
  }

  async getMetadata(tmdbId: string, type: "movie" | "tv"): Promise<CanonicalMetadata | null> {
    const row = await selectMetadata(this.db, tmdbId, type);
    if (row) this.recordAccess([{ tmdbId, type }]);
    return row;
  }

  async getMetadataBatch(items: MetadataKey[]): Promise<Record<string, CanonicalMetadata>> {
    if (items.length === 0) return {};
    const { out, accessed } = await selectMetadataBatch(this.db, items);
    if (accessed.length > 0) this.recordAccess(accessed);
    return out;
  }

  // fallow-ignore-next-line unused-class-member
  async getMetadataWithIds(
    tmdbId: string,
    type: "movie" | "tv",
  ): Promise<CanonicalMetadataWithIds | null> {
    const row = await selectMetadataWithIds(this.db, tmdbId, type);
    if (row) this.recordAccess([{ tmdbId, type }]);
    return row;
  }

  async writeMetadata(rows: CanonicalMetadata[]): Promise<void> {
    await upsertMetadata(this.db, rows);
  }

  /** COALESCE-only artwork patch (V47/V48); see `patchArtworkUrls`. */
  async patchArtwork(
    key: MetadataKey,
    urls: {
      posterUrl?: string | null;
      backdropUrl?: string | null;
      clearLogoUrl?: string | null;
    },
  ): Promise<void> {
    await patchArtworkUrls(this.db, key, urls);
  }

  // fallow-ignore-next-line unused-class-member
  async listStaleMetadata(staleAfterMs: number, limit: number): Promise<MetadataKey[]> {
    return selectStaleMetadataKeys(this.db, staleAfterMs, limit);
  }

  async getDiscoverFeed(
    kind: DiscoverFeedKind,
    sort: DiscoverSort,
    day: number,
  ): Promise<MetadataKey[] | null> {
    return selectDiscoverFeed(this.db, kind, sort, day);
  }

  /** Cheap existence probe for a `(kind, sort, day)` discover snapshot. */
  async hasDiscoverFeed(kind: DiscoverFeedKind, sort: DiscoverSort, day: number): Promise<boolean> {
    return discoverFeedExists(this.db, kind, sort, day);
  }

  /**
   * Pure, session-less read of today's cached trending feed projected to
   * canonical metadata, in feed order. Backs the public pre-auth poster grid:
   * it reuses the same daily snapshot as `discover/trending` and the
   * `trendingNow` home row, doing only cached DB reads and no per-request
   * catalog or plugin work. In particular it does **not** record metadata
   * access, so anonymous login-page traffic never mutates catalog state nor
   * keeps trending rows artificially warm against pruning. Returns `[]` when
   * the day's snapshot is absent, and drops feed keys with no metadata row
   * while preserving order.
   */
  async getTrendingMetadata(limit: number): Promise<CanonicalMetadata[]> {
    const keys = await this.getDiscoverFeed("trending", "popularity_desc", utcDayBucket());
    if (!keys || keys.length === 0) return [];
    const sliced = keys.slice(0, limit);
    // Side-effect-free read: go straight to the batch select, skipping the
    // access recording getMetadataBatch performs, so anonymous traffic never
    // mutates catalog state (see the contract above).
    const { out } = await selectMetadataBatch(this.db, sliced);
    return sliced.map((k) => out[`${k.type}:${k.tmdbId}`]).filter(Boolean) as CanonicalMetadata[];
  }

  async getRecommendations(
    userId: string,
    kind: RecommendationListKind = "default",
  ): Promise<RecommendationList | null> {
    return selectRecommendations(this.db, userId, kind);
  }

  async getUserHistory(userId: string): Promise<HistoryEvent[]> {
    return selectUserHistory(this.db, userId);
  }

  async getUserRatings(userId: string): Promise<RatingEvent[]> {
    return selectUserRatings(this.db, userId);
  }

  /**
   * Distinct ids of users whose history mirror was synced at or after
   * `cutoff`. Lets the home warm job count "recently active" users without
   * reaching into the catalog-owned `user_history_mirror` table directly.
   */
  async listUserIdsSyncedSince(cutoff: number): Promise<string[]> {
    return selectUserIdsSyncedSince(this.db, cutoff);
  }

  // fallow-ignore-next-line unused-class-member
  async getHistoryCursors(userId: string): Promise<PluginCursors> {
    return selectHistoryCursors(this.db, userId);
  }

  // fallow-ignore-next-line unused-class-member
  async getRatingsCursors(userId: string): Promise<PluginCursors> {
    return selectRatingsCursors(this.db, userId);
  }

  // fallow-ignore-next-line unused-class-member
  async writeDiscoverSnapshot(
    kind: DiscoverFeedKind,
    sort: DiscoverSort,
    day: number,
    items: MetadataKey[],
  ): Promise<void> {
    await upsertDiscoverSnapshot(this.db, kind, sort, day, items);
  }

  // fallow-ignore-next-line unused-class-member
  async writeRecommendationList(
    userId: string,
    kind: RecommendationListKind,
    items: RecItem[],
    profileVersion: number,
  ): Promise<void> {
    await upsertRecommendationList(this.db, userId, kind, items, profileVersion);
  }

  // fallow-ignore-next-line unused-class-member
  async appendUserHistory(
    userId: string,
    events: HistoryEvent[],
    pluginId: string,
    cursorTs: number,
  ): Promise<void> {
    await appendHistoryEvents(this.mirrorStore(), userId, events, pluginId, cursorTs);
  }

  // fallow-ignore-next-line unused-class-member
  async appendUserRatings(
    userId: string,
    events: RatingEvent[],
    pluginId: string,
    cursorTs: number,
  ): Promise<void> {
    await appendRatingEvents(this.mirrorStore(), userId, events, pluginId, cursorTs);
  }

  recordAccess(items: MetadataKey[]): void {
    recordMetadataAccess(
      { db: this.db, throttle: this.accessThrottle, throttleMs: this.recordAccessThrottleMs },
      items,
    );
  }

  // fallow-ignore-next-line unused-class-member
  async pruneUnusedMetadata(
    unusedAfterMs: number,
    refSet?: Set<string>,
    snapshotRetentionDays = 7,
  ): Promise<{ deleted: number }> {
    return pruneUnusedMetadataRows(this.db, unusedAfterMs, refSet, snapshotRetentionDays);
  }

  // fallow-ignore-next-line unused-class-member
  async pruneOldDiscoverSnapshots(olderThanDays: number): Promise<{ deleted: number }> {
    return deleteOldDiscoverSnapshots(this.db, olderThanDays);
  }

  private mirrorStore(): MirrorStore {
    return { db: this.db, mutex: this.mirrorMutex };
  }
}

let instance: CatalogService | undefined;

/**
 * Returns the process-wide singleton. The catalog is intentionally a single
 * instance per process so per-process state (Phase 6's `recordAccess`
 * throttle map) stays consistent across every read site — preference
 * engine, scheduled jobs, and home-feed handlers all share one map.
 */
export function getCatalogService(): CatalogService {
  if (!instance) instance = new CatalogService(getDb());
  return instance;
}
