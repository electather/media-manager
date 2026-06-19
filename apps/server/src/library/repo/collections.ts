import { and, asc, eq, gt, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, type Db } from "../../db/client";
import { libraryItems } from "../../db/schema/library";
import type { LibraryRow } from "../types";
import { inList, ownedFilterConditions, ROW_COLUMNS, type LensFilters } from "./lens-pages";

/** The maximum preview ids gathered per franchise group (design §Collections lens: "preview ≤4"). */
const PREVIEW_LIMIT = 4;

/**
 * The delimiter the per-group preview `group_concat` joins ids on, then the
 * caller splits back out. Safe because the only values concatenated are composite
 * library ids (`"<mediaType>:<tmdbId>"`) whose grammar is comma-free; if the id
 * format ever admits a comma this split would mis-parse, so the invariant is
 * load-bearing.
 */
const PREVIEW_SEP = ",";

/**
 * The keyset ordering key for a franchise group: the display title, falling back
 * to the stable collection id when a group has no learned title yet. The cursor
 * encodes this SAME coalesced value (`CollectionGroup.collectionName` is already
 * `collection_name ?? collection_id`), so the `ORDER BY` and the cursor predicate
 * MUST both compare `COALESCE(collection_name, collection_id)` — comparing the
 * raw nullable column would disagree with the encoded cursor and silently drop
 * every null-name group at a page boundary (the phase-2 timeline COALESCE lesson
 * applied to the group key). A collection's rows all share one franchise title,
 * so the value is stable per group.
 */
const collectionSortKey = sql`COALESCE(${libraryItems.collectionName}, ${libraryItems.collectionId})`;

/**
 * Keyset resume position for the Collections lens: the last returned group's
 * `(collectionName, collectionId)`. `collectionName` is the human title the
 * groups order by; `collectionId` is the stable tie-break. The cursor encodes
 * the LAST RETURNED group (never the dropped `limit + 1` overflow group) and its
 * predicate uses the SAME `(collection_name, collection_id)` ordering the
 * `ORDER BY` uses, so a page boundary neither drops nor duplicates a franchise
 * (phase-2 keyset lessons applied to the group-first read).
 */
export interface CollectionCursor {
  collectionName: string;
  collectionId: string;
}

/** One franchise group plus its preview ids, before the service enriches them. */
export interface CollectionGroup {
  collectionId: string;
  /** The franchise display title. Never null: the GROUP BY only sees non-null collection ids. */
  collectionName: string;
  /** Total owned titles in the franchise (may exceed `previewIds.length`). */
  count: number;
  /** Up to {@link PREVIEW_LIMIT} owned-title ids, ordered by `(sortTitle, id)`. */
  previewIds: string[];
}

/** One page of franchise groups plus the next-page marker (the last returned group). */
export interface CollectionsPage {
  groups: CollectionGroup[];
  /** The last group when the page was full, so the service mints the next cursor; absent when exhausted. */
  nextGroup?: CollectionGroup;
}

/**
 * The raw shape the grouping query returns before the preview-id string is
 * split. `collectionId` is typed nullable to match the column's select
 * inference, but the `collection_id IS NOT NULL` WHERE guarantees it is non-null
 * at runtime (narrowed in {@link toCollectionGroup}).
 */
interface CollectionGroupRow {
  collectionId: string | null;
  collectionName: string | null;
  count: number;
  previewIds: string | null;
}

/**
 * Pages the Collections lens group-first over the user's owned franchises
 * (design §Collections lens). Groups the owned set by `collection_id`, ordered
 * by `(collection_name, collection_id)` keyset, returning each franchise's owned
 * title count and up to four preview ids for the poster fan. Owned-only by
 * construction: the WHERE scopes to `owned = true` and `collection_id IS NOT
 * NULL`, so standalone titles and TV (both null `collection_id`) are excluded
 * and a franchise surfaces only when it has at least one owned movie. The same
 * filter axes the item lenses use narrow the grouped set. Selects `limit + 1`
 * groups so the caller detects a next page without a count query; the overflow
 * group is dropped and surfaced as `nextGroup`.
 */
export async function selectCollections(
  userId: string,
  filters: LensFilters,
  cursor: CollectionCursor | undefined,
  limit: number,
  db: Db = getDb(),
): Promise<CollectionsPage> {
  const where = and(
    ...ownedFilterConditions(userId, filters),
    isNotNull(libraryItems.collectionId),
    ...collectionCursorCondition(cursor),
  );
  const rows = await db
    .select({
      collectionId: libraryItems.collectionId,
      collectionName: libraryItems.collectionName,
      count: sql<number>`count(*)`.as("count"),
      previewIds: previewIdsExpr(userId, filters),
    })
    .from(libraryItems)
    .where(where)
    // Order by the SAME coalesced key the cursor predicate compares so the sort
    // and the keyset agree on the group boundary, tie-broken by the stable
    // (non-null here) collection id.
    .groupBy(libraryItems.collectionId)
    .orderBy(collectionSortKey, asc(libraryItems.collectionId))
    .limit(limit + 1);
  return toCollectionsPage(rows.map(toCollectionGroup), limit);
}

/**
 * Fetches the full browse rows for a set of preview ids in one indexed read so
 * the service can enrich them into `CompactMediaItem`s without re-probing. Rows
 * come back in arbitrary order; the service re-orders each group's preview to
 * the id order `selectCollections` chose (by `(sortTitle, id)`). Scoped to the
 * requesting user's owned rows: the composite id is global (not per-user), so an
 * unscoped `id IN (…)` read would be a cross-tenant leak — every library read is
 * owned-set scoped (design §Architecture).
 */
export async function selectRowsByIds(
  userId: string,
  ids: string[],
  db: Db = getDb(),
): Promise<LibraryRow[]> {
  if (ids.length === 0) return [];
  return db
    .select(ROW_COLUMNS)
    .from(libraryItems)
    .where(and(eq(libraryItems.userId, userId), eq(libraryItems.owned, true), idInList(ids)));
}

/**
 * The per-group preview-id aggregate: a correlated subquery that takes the first
 * {@link PREVIEW_LIMIT} owned ids of the franchise ordered by `(sort_title, id)`
 * and joins them on {@link PREVIEW_SEP}. SQLite's `group_concat` cannot itself
 * order-and-limit per group, so the ordered+limited id set is selected in an
 * inner subquery and concatenated in the outer one. The preview ordering is
 * documented as `(sortTitle, id)` ascending — the same order the A–Z lens uses —
 * so the poster fan is stable run-to-run. The `user_id` is bound (not the outer
 * row's) so the subquery uses the `(user_id, owned, collection_id)` index.
 */
function previewIdsExpr(userId: string, filters: LensFilters): SQL<string | null> {
  const extra = innerFilterConditions(filters);
  const filterClause = extra.length > 0 ? sql` AND ${sql.join(extra, sql` AND `)}` : sql``;
  return sql<string | null>`(
    SELECT group_concat(p.id, ${PREVIEW_SEP})
    FROM (
      SELECT inner_li.id AS id
      FROM ${libraryItems} inner_li
      WHERE inner_li.user_id = ${userId}
        AND inner_li.owned = 1
        AND inner_li.collection_id = ${libraryItems.collectionId}${filterClause}
      ORDER BY inner_li.sort_title, inner_li.id
      LIMIT ${PREVIEW_LIMIT}
    ) p
  )`;
}

/**
 * The active filter axes re-expressed against the `inner_li` preview subquery
 * alias so the poster fan honours the SAME filters as the group count — without
 * this the count is filter-aware but the preview can surface titles excluded
 * from the count. Mirrors the lens-page filter predicates (kinds/watched as
 * column membership, genres/qualities/servers as `json_each` membership); every
 * value stays a bound parameter via {@link inList}.
 */
function innerFilterConditions(filters: LensFilters): SQL[] {
  const conditions: SQL[] = [];
  if (filters.kinds && filters.kinds.length > 0) {
    conditions.push(sql`inner_li.media_type IN ${inList(filters.kinds)}`);
  }
  if (filters.watched && filters.watched.length > 0) {
    conditions.push(sql`inner_li.watched_state IN ${inList(filters.watched)}`);
  }
  if (filters.genres && filters.genres.length > 0) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM json_each(inner_li.genres) WHERE value IN ${inList(filters.genres)})`,
    );
  }
  if (filters.qualities && filters.qualities.length > 0) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM json_each(inner_li.quality_tiers) WHERE value IN ${inList(filters.qualities)})`,
    );
  }
  if (filters.servers && filters.servers.length > 0) {
    // Match on the human-readable `label`, not the connection `id`: the facets
    // repo keys the `servers` count map on `label` and the FE popover sends that
    // label back as `filters.servers`, so the preview filter must agree with the
    // facet key and the lens-page filter on the label.
    conditions.push(
      sql`EXISTS (SELECT 1 FROM json_each(inner_li.servers) WHERE value ->> 'label' IN ${inList(filters.servers)})`,
    );
  }
  return conditions;
}

/**
 * Keyset predicate for the Collections lens: groups strictly after
 * `(collectionName, collectionId)` in ascending order. A larger name, or the
 * same name with a larger id, is "after". The comparison columns match the
 * `ORDER BY` exactly so a page boundary is stable.
 */
function collectionCursorCondition(cursor: CollectionCursor | undefined): SQL[] {
  if (!cursor) return [];
  return [
    or(
      sql`${collectionSortKey} > ${cursor.collectionName}`,
      and(
        sql`${collectionSortKey} = ${cursor.collectionName}`,
        gt(libraryItems.collectionId, cursor.collectionId),
      ),
    )!,
  ];
}

/** Renders `ids` as a `library_items.id IN (?, ?, …)` predicate of bound parameters. */
function idInList(ids: string[]): SQL {
  const list = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
  return sql`${libraryItems.id} IN (${list})`;
}

/** Maps a grouping query row onto a {@link CollectionGroup}, splitting the joined preview ids. */
function toCollectionGroup(row: CollectionGroupRow): CollectionGroup {
  // Non-null at runtime: the grouping query filters `collection_id IS NOT NULL`.
  const collectionId = row.collectionId!;
  return {
    collectionId,
    // A non-null `collection_id` may still carry a null name if hydrate never
    // learned the franchise title; fall back to the id so the group still has a
    // stable, non-empty title rather than rendering blank.
    collectionName: row.collectionName ?? collectionId,
    count: row.count,
    previewIds: row.previewIds ? row.previewIds.split(PREVIEW_SEP) : [],
  };
}

/**
 * Splits the `limit + 1` over-fetch into the page groups plus the next-page
 * marker. When the query returned more than `limit` groups there is another
 * page, so the trailing group is dropped from the page and returned as
 * `nextGroup` for the service to encode into the keyset cursor — the LAST
 * RETURNED group, never the dropped overflow group (phase-2 lesson: the keyset
 * predicate is strictly-greater, so encoding the overflow would skip it). A
 * short read means the scan is exhausted and no `nextGroup` is emitted.
 */
function toCollectionsPage(groups: CollectionGroup[], limit: number): CollectionsPage {
  if (groups.length <= limit) return { groups };
  const page = groups.slice(0, limit);
  return { groups: page, nextGroup: page[page.length - 1]! };
}
