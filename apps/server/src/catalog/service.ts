import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { canonicalMetadata, discoverSnapshots, recommendationLists } from "../db/schema/catalog";
import { idMap } from "../db/schema/id-map";
import { candidateId } from "./features";
import type {
  CanonicalMetadata,
  CanonicalMetadataWithIds,
  DiscoverFeedKind,
  DiscoverSort,
  HistoryEvent,
  IdMap,
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
 */
export class CatalogService {
  readonly recordAccessThrottleMs: number;

  private readonly db: Db;

  constructor(db: Db, opts: CatalogServiceOptions = {}) {
    this.db = db;
    this.recordAccessThrottleMs = opts.recordAccessThrottleMs ?? DEFAULT_RECORD_ACCESS_THROTTLE_MS;
  }

  async getMetadata(tmdbId: string, type: "movie" | "tv"): Promise<CanonicalMetadata | null> {
    const row = await this.db
      .select()
      .from(canonicalMetadata)
      .where(and(eq(canonicalMetadata.tmdbId, tmdbId), eq(canonicalMetadata.mediaType, type)))
      .get();
    return row ?? null;
  }

  async getMetadataBatch(items: MetadataKey[]): Promise<Record<string, CanonicalMetadata>> {
    if (items.length === 0) return {};
    // SQLite has no row-tuple `IN ((a,b), …)` form, so we batch per
    // `mediaType` and union the results. Two queries max in practice;
    // the composite PK serves both lookups via index.
    const buckets = new Map<"movie" | "tv", string[]>();
    for (const item of items) {
      const list = buckets.get(item.type);
      if (list) list.push(item.tmdbId);
      else buckets.set(item.type, [item.tmdbId]);
    }
    const out: Record<string, CanonicalMetadata> = {};
    for (const [type, ids] of buckets) {
      const rows = await this.db
        .select()
        .from(canonicalMetadata)
        .where(and(eq(canonicalMetadata.mediaType, type), inArray(canonicalMetadata.tmdbId, ids)));
      for (const row of rows) {
        out[candidateId({ tmdbId: row.tmdbId, type: row.mediaType })] = row;
      }
    }
    return out;
  }

  async getMetadataWithIds(
    tmdbId: string,
    type: "movie" | "tv",
  ): Promise<CanonicalMetadataWithIds | null> {
    const row = await this.db
      .select({
        canonical: canonicalMetadata,
        ids: idMap,
      })
      .from(canonicalMetadata)
      .leftJoin(
        idMap,
        and(
          eq(idMap.tmdbId, canonicalMetadata.tmdbId),
          eq(idMap.mediaType, canonicalMetadata.mediaType),
        ),
      )
      .where(and(eq(canonicalMetadata.tmdbId, tmdbId), eq(canonicalMetadata.mediaType, type)))
      .get();
    if (!row) return null;
    return { ...row.canonical, ids: toIdMap(row.ids) };
  }

  async writeMetadata(rows: CanonicalMetadata[]): Promise<void> {
    if (rows.length === 0) return;
    // INSERT-OR-REPLACE. `created_at` is preserved on update via SQL
    // `COALESCE(existing, incoming)`; `last_refreshed_at` always advances
    // to the incoming value so `listStaleMetadata` stays accurate.
    for (const row of rows) {
      await this.db
        .insert(canonicalMetadata)
        .values(row)
        .onConflictDoUpdate({
          target: [canonicalMetadata.tmdbId, canonicalMetadata.mediaType],
          set: {
            title: row.title,
            year: row.year,
            runtimeMinutes: row.runtimeMinutes,
            posterUrl: row.posterUrl,
            backdropUrl: row.backdropUrl,
            clearLogoUrl: row.clearLogoUrl,
            thumbUrl: row.thumbUrl,
            overview: row.overview,
            originalLanguage: row.originalLanguage,
            genres: row.genres,
            features: row.features,
            lastRefreshedAt: row.lastRefreshedAt,
            lastAccessedAt: row.lastAccessedAt,
            createdAt: sql`COALESCE(${canonicalMetadata.createdAt}, ${row.createdAt})`,
          },
        });
    }
  }

  async listStaleMetadata(staleAfterMs: number, limit: number): Promise<MetadataKey[]> {
    const cutoff = Date.now() - staleAfterMs;
    const rows = await this.db
      .select({ tmdbId: canonicalMetadata.tmdbId, mediaType: canonicalMetadata.mediaType })
      .from(canonicalMetadata)
      .where(
        or(
          lt(canonicalMetadata.lastRefreshedAt, cutoff),
          // `features` is NULL when a row was warm-written by the discover
          // snapshot side-effect but never enriched; treat that as stale
          // so the next refresh picks it up.
          sql`${canonicalMetadata.features} IS NULL`,
        ),
      )
      .orderBy(
        // NULL-feature rows come from a side-effect warm and have a fresh
        // `last_refreshed_at`; they would otherwise sort last and miss
        // refresh cycles when 500+ time-stale rows are queued ahead.
        asc(sql`CASE WHEN ${canonicalMetadata.features} IS NULL THEN 0 ELSE 1 END`),
        asc(canonicalMetadata.lastRefreshedAt),
      )
      .limit(limit);
    return rows.map((r) => ({ tmdbId: r.tmdbId, type: r.mediaType }));
  }

  async getDiscoverFeed(
    kind: DiscoverFeedKind,
    sort: DiscoverSort,
    day: number,
  ): Promise<MetadataKey[] | null> {
    const row = await this.db
      .select({ items: discoverSnapshots.items })
      .from(discoverSnapshots)
      .where(
        and(
          eq(discoverSnapshots.feedKind, kind),
          eq(discoverSnapshots.sort, sort),
          eq(discoverSnapshots.day, day),
        ),
      )
      .get();
    return row?.items ?? null;
  }

  async getRecommendations(
    userId: string,
    kind: RecommendationListKind = "default",
  ): Promise<RecommendationList | null> {
    const row = await this.db
      .select()
      .from(recommendationLists)
      .where(and(eq(recommendationLists.userId, userId), eq(recommendationLists.listKind, kind)))
      .get();
    if (!row) return null;
    return {
      items: row.items,
      profileVersion: row.profileVersion,
      generatedAt: row.generatedAt,
    };
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

  async writeDiscoverSnapshot(
    kind: DiscoverFeedKind,
    sort: DiscoverSort,
    day: number,
    items: MetadataKey[],
  ): Promise<void> {
    const generatedAt = Date.now();
    await this.db
      .insert(discoverSnapshots)
      .values({ feedKind: kind, sort, day, items, generatedAt })
      .onConflictDoUpdate({
        target: [discoverSnapshots.feedKind, discoverSnapshots.sort, discoverSnapshots.day],
        set: { items, generatedAt },
      });
  }

  async writeRecommendationList(
    userId: string,
    kind: RecommendationListKind,
    items: RecItem[],
    profileVersion: number,
  ): Promise<void> {
    const generatedAt = Date.now();
    await this.db
      .insert(recommendationLists)
      .values({ userId, listKind: kind, items, profileVersion, generatedAt })
      .onConflictDoUpdate({
        target: [recommendationLists.userId, recommendationLists.listKind],
        set: { items, profileVersion, generatedAt },
      });
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

  async pruneUnusedMetadata(
    _unusedAfterMs: number,
    _refSet?: Set<string>,
  ): Promise<{ deleted: number }> {
    return { deleted: 0 };
  }

  async pruneOldDiscoverSnapshots(olderThanDays: number): Promise<{ deleted: number }> {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const deleted = await this.db
      .delete(discoverSnapshots)
      .where(lt(discoverSnapshots.day, cutoff))
      .returning({ day: discoverSnapshots.day });
    return { deleted: deleted.length };
  }
}

function toIdMap(row: typeof idMap.$inferSelect | null): IdMap | null {
  if (!row) return null;
  return {
    tmdbId: row.tmdbId,
    mediaType: row.mediaType,
    imdbId: row.imdbId ?? null,
    tvdbId: row.tvdbId ?? null,
    traktId: row.traktId ?? null,
    traktSlug: row.traktSlug ?? null,
  };
}
