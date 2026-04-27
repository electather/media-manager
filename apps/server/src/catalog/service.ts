import type { Db } from "../db/client";
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
} from "./types";

const DEFAULT_RECORD_ACCESS_THROTTLE_MS = 60 * 60 * 1000;

export interface CatalogServiceOptions {
  recordAccessThrottleMs?: number;
}

/**
 * Catalog peer of MediaService. Sole owner of the canonical_metadata,
 * discover_snapshots, recommendation_lists, user_history_mirror and
 * user_ratings_mirror tables (V37). Reads serve sub-ms PK lookups; writes
 * are jobs-only except bounded cold-fill from the preference engine (V38).
 *
 * Phase 1 (T25): scaffold only. Every method returns a placeholder so DI
 * wiring and tests can compile against the final surface. Implementations
 * land phase-by-phase in T26-T30.
 */
export class CatalogService {
  readonly recordAccessThrottleMs: number;

  // The Drizzle handle is unused while the surface is stubbed (T25). Phase
  // 2 onward consumes it from every read/write method, so capture it now and
  // keep the constructor signature stable for downstream DI wiring.
  private readonly db: Db;

  constructor(db: Db, opts: CatalogServiceOptions = {}) {
    this.db = db;
    this.recordAccessThrottleMs = opts.recordAccessThrottleMs ?? DEFAULT_RECORD_ACCESS_THROTTLE_MS;
    // `noUnusedLocals` flags the field as unread until Phase 2 wires it
    // through the methods. Reading it here once is the cheapest way to keep
    // the visibility correct (`private`) without leaking it to subclasses.
    void this.db;
  }

  async getMetadata(_tmdbId: string, _type: "movie" | "tv"): Promise<CanonicalMetadata | null> {
    return null;
  }

  async getMetadataBatch(_items: MetadataKey[]): Promise<Record<string, CanonicalMetadata>> {
    return {};
  }

  async getMetadataWithIds(
    _tmdbId: string,
    _type: "movie" | "tv",
  ): Promise<CanonicalMetadataWithIds | null> {
    return null;
  }

  async getDiscoverFeed(
    _kind: DiscoverFeedKind,
    _sort: DiscoverSort,
    _day: number,
  ): Promise<MetadataKey[] | null> {
    return null;
  }

  async getRecommendations(
    _userId: string,
    _kind: RecommendationListKind = "default",
  ): Promise<RecommendationList | null> {
    return null;
  }

  async getUserHistory(_userId: string): Promise<HistoryEvent[]> {
    return [];
  }

  async getUserRatings(_userId: string): Promise<RatingEvent[]> {
    return [];
  }

  async getHistoryCursors(_userId: string): Promise<PluginCursors> {
    return {};
  }

  async getRatingsCursors(_userId: string): Promise<PluginCursors> {
    return {};
  }

  async writeMetadata(_rows: CanonicalMetadata[]): Promise<void> {
    return;
  }

  async writeDiscoverSnapshot(
    _kind: DiscoverFeedKind,
    _sort: DiscoverSort,
    _day: number,
    _items: MetadataKey[],
  ): Promise<void> {
    return;
  }

  async writeRecommendationList(
    _userId: string,
    _kind: RecommendationListKind,
    _items: RecItem[],
    _profileVersion: number,
  ): Promise<void> {
    return;
  }

  async appendUserHistory(
    _userId: string,
    _events: HistoryEvent[],
    _connectionId: string,
    _cursorTs: number,
  ): Promise<void> {
    return;
  }

  async appendUserRatings(
    _userId: string,
    _events: RatingEvent[],
    _connectionId: string,
    _cursorTs: number,
  ): Promise<void> {
    return;
  }

  recordAccess(_items: MetadataKey[]): void {
    return;
  }

  async listStaleMetadata(_staleAfterMs: number, _limit: number): Promise<MetadataKey[]> {
    return [];
  }

  async pruneUnusedMetadata(
    _unusedAfterMs: number,
    _refSet?: Set<string>,
  ): Promise<{ deleted: number }> {
    return { deleted: 0 };
  }

  async pruneOldDiscoverSnapshots(_olderThanDays: number): Promise<{ deleted: number }> {
    return { deleted: 0 };
  }
}
