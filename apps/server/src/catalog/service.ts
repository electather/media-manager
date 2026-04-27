import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  canonicalMetadata,
  discoverSnapshots,
  recommendationLists,
  userHistoryMirror,
  userRatingsMirror,
} from "../db/schema/catalog";
import { idMap } from "../db/schema/id-map";
import { candidateId } from "./features";
import { PerUserMutex } from "./mutex";
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
  private readonly mirrorMutex = new PerUserMutex();

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
    // The `COALESCE` on `created_at` blocks a single multi-row upsert
    // (the SET clause references the existing column), so we still issue
    // one statement per row but bundle them inside a single transaction
    // — collapses 25 individual WAL commits to one and amortizes the
    // round-trip cost of the metadata-refresh batch.
    await this.db.transaction(async (tx) => {
      for (const row of rows) {
        await tx
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
    });
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

  async getUserHistory(userId: string): Promise<HistoryEvent[]> {
    const row = await this.db
      .select({ events: userHistoryMirror.events })
      .from(userHistoryMirror)
      .where(eq(userHistoryMirror.userId, userId))
      .get();
    return row?.events ?? [];
  }

  async getUserRatings(userId: string): Promise<RatingEvent[]> {
    const row = await this.db
      .select({ events: userRatingsMirror.events })
      .from(userRatingsMirror)
      .where(eq(userRatingsMirror.userId, userId))
      .get();
    return row?.events ?? [];
  }

  async getHistoryCursors(userId: string): Promise<PluginCursors> {
    const row = await this.db
      .select({ pluginCursors: userHistoryMirror.pluginCursors })
      .from(userHistoryMirror)
      .where(eq(userHistoryMirror.userId, userId))
      .get();
    return row?.pluginCursors ?? {};
  }

  async getRatingsCursors(userId: string): Promise<PluginCursors> {
    const row = await this.db
      .select({ pluginCursors: userRatingsMirror.pluginCursors })
      .from(userRatingsMirror)
      .where(eq(userRatingsMirror.userId, userId))
      .get();
    return row?.pluginCursors ?? {};
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
    userId: string,
    events: HistoryEvent[],
    connectionId: string,
    cursorTs: number,
  ): Promise<void> {
    if (events.length === 0) return;
    await this.mirrorMutex.run(userId, () =>
      this.db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(userHistoryMirror)
          .where(eq(userHistoryMirror.userId, userId))
          .get();
        const merged = mergeHistory(existing?.events ?? [], events);
        const cursors = mergeCursor(existing?.pluginCursors ?? {}, connectionId, cursorTs);
        const lastSyncedAt = Date.now();
        await tx
          .insert(userHistoryMirror)
          .values({ userId, events: merged, pluginCursors: cursors, lastSyncedAt })
          .onConflictDoUpdate({
            target: [userHistoryMirror.userId],
            set: { events: merged, pluginCursors: cursors, lastSyncedAt },
          });
      }),
    );
  }

  async appendUserRatings(
    userId: string,
    events: RatingEvent[],
    connectionId: string,
    cursorTs: number,
  ): Promise<void> {
    if (events.length === 0) return;
    await this.mirrorMutex.run(userId, () =>
      this.db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(userRatingsMirror)
          .where(eq(userRatingsMirror.userId, userId))
          .get();
        const merged = mergeRatings(existing?.events ?? [], events);
        const cursors = mergeCursor(existing?.pluginCursors ?? {}, connectionId, cursorTs);
        const lastSyncedAt = Date.now();
        await tx
          .insert(userRatingsMirror)
          .values({ userId, events: merged, pluginCursors: cursors, lastSyncedAt })
          .onConflictDoUpdate({
            target: [userRatingsMirror.userId],
            set: { events: merged, pluginCursors: cursors, lastSyncedAt },
          });
      }),
    );
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

/**
 * Append-only merge for the history mirror. Dedupe key is
 * `(tmdbId, mediaType, sourceConnectionId, watchedAt, episodeKey ?? '')`
 * so re-syncing the same plugin window is idempotent. Existing events keep
 * their original ordering; new events append in arrival order.
 */
function mergeHistory(prior: HistoryEvent[], next: HistoryEvent[]): HistoryEvent[] {
  const seen = new Set<string>();
  const out: HistoryEvent[] = [];
  for (const event of prior) {
    const key = historyKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  for (const event of next) {
    const key = historyKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

function mergeRatings(prior: RatingEvent[], next: RatingEvent[]): RatingEvent[] {
  const seen = new Set<string>();
  const out: RatingEvent[] = [];
  for (const event of prior) {
    const key = ratingKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  for (const event of next) {
    const key = ratingKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

function historyKey(event: HistoryEvent): string {
  return `${event.tmdbId}|${event.mediaType}|${event.sourceConnectionId}|${event.watchedAt}|${event.episodeKey ?? ""}`;
}

function ratingKey(event: RatingEvent): string {
  return `${event.tmdbId}|${event.mediaType}|${event.sourceConnectionId}|${event.ratedAt}`;
}

/**
 * Cursor merge: per V39 the cursor advances monotonically per connection.
 * `max(prior, incoming)` so a sync that lands an older window cannot
 * rewind a connection's progress, even if events themselves are
 * out-of-order.
 */
function mergeCursor(prior: PluginCursors, connectionId: string, cursorTs: number): PluginCursors {
  const previous = prior[connectionId] ?? 0;
  return { ...prior, [connectionId]: Math.max(previous, cursorTs) };
}
