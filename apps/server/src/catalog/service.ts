import { and, asc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";

type DbTransaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
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
  // In-process throttle keyed by `${type}:${tmdbId}`. Each entry is the
  // last-seen monotonic timestamp; a fresh `recordAccess` only enqueues
  // the row for an UPDATE if `now - prior >= recordAccessThrottleMs`.
  private readonly accessThrottle = new Map<string, number>();

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
    if (row) this.recordAccess([{ tmdbId, type }]);
    return row ?? null;
  }

  // fallow-ignore-next-line unused-class-member
  // fallow-ignore-next-line complexity
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
    const accessed: MetadataKey[] = [];
    for (const [type, ids] of buckets) {
      const rows = await this.db
        .select()
        .from(canonicalMetadata)
        .where(and(eq(canonicalMetadata.mediaType, type), inArray(canonicalMetadata.tmdbId, ids)));
      for (const row of rows) {
        out[candidateId({ tmdbId: row.tmdbId, type: row.mediaType })] = row;
        accessed.push({ tmdbId: row.tmdbId, type: row.mediaType });
      }
    }
    if (accessed.length > 0) this.recordAccess(accessed);
    return out;
  }

  // fallow-ignore-next-line unused-class-member
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
    this.recordAccess([{ tmdbId, type }]);
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
              // Plain assignment, not COALESCE: TMDB metadata never returns
              // clearLogo, so a 30-day nightly refresh resets the value to
              // null and the next render re-runs `/artwork.get` to refill
              // it. Accepted per design failure-semantics; `patchArtwork`
              // owns the COALESCE-preserving write path.
              clearLogoUrl: row.clearLogoUrl,
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

  /**
   * COALESCE-only artwork patch (V47/V48). Each non-null arg fills the
   * matching column when it is currently null; filled columns are never
   * overwritten. Row absent → 0 rows affected, no throw — `/artwork.get`
   * may resolve before the cold-fill metadata write lands. Always bumps
   * `last_refreshed_at` so a patched row counts as fresh against the
   * nightly refresh cutoff.
   */
  async patchArtwork(
    key: MetadataKey,
    urls: {
      posterUrl?: string | null;
      backdropUrl?: string | null;
      clearLogoUrl?: string | null;
    },
  ): Promise<void> {
    const now = Date.now();
    await this.db
      .update(canonicalMetadata)
      .set({
        posterUrl: sql`COALESCE(${canonicalMetadata.posterUrl}, ${urls.posterUrl ?? null})`,
        backdropUrl: sql`COALESCE(${canonicalMetadata.backdropUrl}, ${urls.backdropUrl ?? null})`,
        clearLogoUrl: sql`COALESCE(${canonicalMetadata.clearLogoUrl}, ${urls.clearLogoUrl ?? null})`,
        lastRefreshedAt: now,
      })
      .where(
        and(eq(canonicalMetadata.tmdbId, key.tmdbId), eq(canonicalMetadata.mediaType, key.type)),
      );
  }

  // fallow-ignore-next-line unused-class-member
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

  // fallow-ignore-next-line unused-class-member
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

  // fallow-ignore-next-line unused-class-member
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

  // fallow-ignore-next-line unused-class-member
  async getHistoryCursors(userId: string): Promise<PluginCursors> {
    const row = await this.db
      .select({ pluginCursors: userHistoryMirror.pluginCursors })
      .from(userHistoryMirror)
      .where(eq(userHistoryMirror.userId, userId))
      .get();
    return row?.pluginCursors ?? {};
  }

  // fallow-ignore-next-line unused-class-member
  async getRatingsCursors(userId: string): Promise<PluginCursors> {
    const row = await this.db
      .select({ pluginCursors: userRatingsMirror.pluginCursors })
      .from(userRatingsMirror)
      .where(eq(userRatingsMirror.userId, userId))
      .get();
    return row?.pluginCursors ?? {};
  }

  // fallow-ignore-next-line unused-class-member
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

  // fallow-ignore-next-line unused-class-member
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

  // fallow-ignore-next-line unused-class-member
  async appendUserHistory(
    userId: string,
    events: HistoryEvent[],
    pluginId: string,
    cursorTs: number,
  ): Promise<void> {
    await this.appendMirrorRows(
      userId,
      events,
      pluginId,
      cursorTs,
      {
        select: (tx) =>
          tx.select().from(userHistoryMirror).where(eq(userHistoryMirror.userId, userId)).get(),
        upsert: (tx, merged, cursors, lastSyncedAt) =>
          tx
            .insert(userHistoryMirror)
            .values({ userId, events: merged, pluginCursors: cursors, lastSyncedAt })
            .onConflictDoUpdate({
              target: [userHistoryMirror.userId],
              set: { events: merged, pluginCursors: cursors, lastSyncedAt },
            }),
      },
      mergeHistory,
    );
  }

  // fallow-ignore-next-line unused-class-member
  async appendUserRatings(
    userId: string,
    events: RatingEvent[],
    pluginId: string,
    cursorTs: number,
  ): Promise<void> {
    await this.appendMirrorRows(
      userId,
      events,
      pluginId,
      cursorTs,
      {
        select: (tx) =>
          tx.select().from(userRatingsMirror).where(eq(userRatingsMirror.userId, userId)).get(),
        upsert: (tx, merged, cursors, lastSyncedAt) =>
          tx
            .insert(userRatingsMirror)
            .values({ userId, events: merged, pluginCursors: cursors, lastSyncedAt })
            .onConflictDoUpdate({
              target: [userRatingsMirror.userId],
              set: { events: merged, pluginCursors: cursors, lastSyncedAt },
            }),
      },
      mergeRatings,
    );
  }

  private async appendMirrorRows<E>(
    userId: string,
    events: E[],
    pluginId: string,
    cursorTs: number,
    tableOps: {
      select: (
        tx: DbTransaction,
      ) => Promise<{ events: E[]; pluginCursors: PluginCursors } | undefined>;
      upsert: (
        tx: DbTransaction,
        events: E[],
        cursors: PluginCursors,
        lastSyncedAt: number,
      ) => PromiseLike<unknown>;
    },
    mergeEvents: (prior: E[], next: E[]) => E[],
  ): Promise<void> {
    if (events.length === 0) return;
    await this.mirrorMutex.run(userId, () =>
      this.db.transaction(async (tx) => {
        const existing = await tableOps.select(tx);
        const merged = mergeEvents(existing?.events ?? [], events);
        const cursors = mergeCursor(existing?.pluginCursors ?? {}, pluginId, cursorTs);
        await tableOps.upsert(tx, merged, cursors, Date.now());
      }),
    );
  }

  // fallow-ignore-next-line complexity
  recordAccess(items: MetadataKey[]): void {
    if (items.length === 0) return;
    const now = Date.now();
    const dueByType = new Map<"movie" | "tv", string[]>();
    for (const item of items) {
      const key = candidateId(item);
      const prior = this.accessThrottle.get(key);
      if (prior !== undefined && now - prior < this.recordAccessThrottleMs) continue;
      this.accessThrottle.set(key, now);
      const list = dueByType.get(item.type);
      if (list) list.push(item.tmdbId);
      else dueByType.set(item.type, [item.tmdbId]);
    }
    if (dueByType.size === 0) return;
    // Detached batch update — reads must not block on the write. Failures
    // log and drop; the next access cycle picks the row back up.
    void this.flushAccessUpdates(dueByType, now);
    this.evictStaleThrottleEntries(now);
  }

  private async flushAccessUpdates(
    dueByType: Map<"movie" | "tv", string[]>,
    now: number,
  ): Promise<void> {
    for (const [type, ids] of dueByType) {
      try {
        await this.db
          .update(canonicalMetadata)
          .set({ lastAccessedAt: now })
          .where(
            and(eq(canonicalMetadata.mediaType, type), inArray(canonicalMetadata.tmdbId, ids)),
          );
      } catch (err) {
        // Per V37, the catalog tolerates a dropped access bump; the next
        // read for the same row will re-enqueue it.
        // eslint-disable-next-line no-console
        console.warn("[catalog:recordAccess] update failed:", err);
      }
    }
  }

  private evictStaleThrottleEntries(now: number): void {
    // Cap memory by dropping entries that have aged past 2× the throttle
    // window — long enough to absorb back-to-back access bursts but
    // bounded so the map cannot grow without limit on long-lived processes.
    const cutoff = now - this.recordAccessThrottleMs * 2;
    for (const [key, ts] of this.accessThrottle) {
      if (ts < cutoff) this.accessThrottle.delete(key);
    }
  }

  // fallow-ignore-next-line unused-class-member
  // fallow-ignore-next-line complexity
  async pruneUnusedMetadata(
    unusedAfterMs: number,
    refSet?: Set<string>,
    snapshotRetentionDays = 7,
  ): Promise<{ deleted: number }> {
    const cutoff = Date.now() - unusedAfterMs;
    const refs = refSet ?? (await this.buildPruneRefSet(snapshotRetentionDays));
    const candidates = await this.db
      .select({ tmdbId: canonicalMetadata.tmdbId, mediaType: canonicalMetadata.mediaType })
      .from(canonicalMetadata)
      .where(lt(canonicalMetadata.lastAccessedAt, cutoff));
    // Bucket non-referenced ids by media type so each type drops in a
    // single statement. Per-row DELETEs would hold the SQLite WAL for
    // the entire sweep; bucketed DELETEs collapse to one commit per type.
    const toDelete = new Map<"movie" | "tv", string[]>();
    for (const row of candidates) {
      const key = candidateId({ tmdbId: row.tmdbId, type: row.mediaType });
      if (refs.has(key)) continue;
      const list = toDelete.get(row.mediaType);
      if (list) list.push(row.tmdbId);
      else toDelete.set(row.mediaType, [row.tmdbId]);
    }
    let deleted = 0;
    for (const [type, ids] of toDelete) {
      if (ids.length === 0) continue;
      await this.db
        .delete(canonicalMetadata)
        .where(and(eq(canonicalMetadata.mediaType, type), inArray(canonicalMetadata.tmdbId, ids)));
      deleted += ids.length;
    }
    return { deleted };
  }

  /**
   * Builds the in-memory reference set used by `pruneUnusedMetadata`. Pulls
   * every id from `recommendation_lists.items` plus discover snapshots
   * within the configured retention window so a row can be cold-by-access
   * yet still pinned by an active rec list or recent snapshot.
   */
  private async buildPruneRefSet(snapshotRetentionDays: number): Promise<Set<string>> {
    const refs = new Set<string>();
    const lists = await this.db
      .select({ items: recommendationLists.items })
      .from(recommendationLists);
    for (const row of lists) {
      for (const item of row.items) {
        refs.add(candidateId({ tmdbId: item.tmdbId, type: item.mediaType }));
      }
    }
    const cutoff = Date.now() - snapshotRetentionDays * 24 * 60 * 60 * 1000;
    const snapshots = await this.db
      .select({ items: discoverSnapshots.items })
      .from(discoverSnapshots)
      .where(gte(discoverSnapshots.day, cutoff));
    for (const snapshot of snapshots) {
      for (const ref of snapshot.items) {
        refs.add(candidateId(ref));
      }
    }
    return refs;
  }

  // fallow-ignore-next-line unused-class-member
  async pruneOldDiscoverSnapshots(olderThanDays: number): Promise<{ deleted: number }> {
    const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
    const deleted = await this.db
      .delete(discoverSnapshots)
      .where(lt(discoverSnapshots.day, cutoff))
      .returning({ day: discoverSnapshots.day });
    return { deleted: deleted.length };
  }
}

// fallow-ignore-next-line complexity
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
function mergeCursor(prior: PluginCursors, pluginId: string, cursorTs: number): PluginCursors {
  const previous = prior[pluginId] ?? 0;
  return { ...prior, [pluginId]: Math.max(previous, cursorTs) };
}
