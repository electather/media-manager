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
 * Replicated here (not imported from home) to avoid inverting the dependency direction.
 */
function utcDayBucket(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

interface CatalogServiceOptions {
  recordAccessThrottleMs?: number;
}

/**
 * Sole owner of canonical_metadata, discover_snapshots, recommendation_lists, user_history_mirror,
 * user_ratings_mirror (V37); writes job-only except bounded cold-fill from preference engine (V38).
 * Thin facade over sibling modules; owns the per-process state they share.
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
   * Session-less read of today's cached trending feed; backs public pre-auth poster grid.
   * Does **not** record metadata access, so anonymous traffic never mutates catalog state nor
   * artificially warms trending rows against pruning. Returns `[]` when snapshot absent.
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
 * Process-wide singleton. Ensures per-process state (Phase 6's `recordAccess` throttle)
 * stays consistent across all read sites.
 */
export function getCatalogService(): CatalogService {
  if (!instance) instance = new CatalogService(getDb());
  return instance;
}
