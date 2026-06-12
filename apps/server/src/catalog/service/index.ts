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
} from "@ent-mcp/shared/catalog";
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
  selectHistoryCursors,
  selectRatingsCursors,
  selectUserHistory,
  selectUserRatings,
} from "./user-mirrors";

export const DEFAULT_RECORD_ACCESS_THROTTLE_MS = 60 * 60 * 1000;

export interface CatalogServiceOptions {
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

  // fallow-ignore-next-line
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

  // fallow-ignore-next-line unused-class-member
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

  private mirrorStore(): { db: Db; mutex: PerUserMutex } {
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

/** Test helper: drop the singleton so the next `get` rebuilds from scratch. */
export function resetCatalogServiceForTest(): void {
  instance = undefined;
}

/** Test helper: install an arbitrary catalog instance (e.g. with an in-memory DB). */
export function setCatalogServiceForTest(svc: CatalogService): void {
  instance = svc;
}
