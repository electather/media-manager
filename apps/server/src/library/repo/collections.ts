import { and, asc, eq, gt, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, type Db } from "../../db/client";
import { libraryItems } from "../../db/schema/library";
import type { LibraryRow } from "../types";
import { inList, ownedFilterConditions, ROW_COLUMNS, type LensFilters } from "./lens-pages";

/** The maximum preview ids gathered per franchise group (design §Collections lens: "preview ≤4"). */
const PREVIEW_LIMIT = 4;

/** Delimiter for group_concat; safe because library ids are comma-free (if format changes, split breaks). */
const PREVIEW_SEP = ",";

/** Sort key coalesced (collection_name ?? id); cursor encodes SAME value so ORDER BY and keyset predicate agree at boundaries. */
const collectionSortKey = sql`COALESCE(${libraryItems.collectionName}, ${libraryItems.collectionId})`;

/** Cursor encodes LAST RETURNED group (never overflow) with same (name, id) ordering as ORDER BY to prevent duplication. */
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

/** Raw grouping row; collectionId typed nullable but guaranteed non-null at runtime by WHERE clause. */
interface CollectionGroupRow {
  collectionId: string | null;
  collectionName: string | null;
  count: number;
  previewIds: string | null;
}

/** Groups owned franchises by collection_id, ordered keyset, returning count + up to PREVIEW_LIMIT preview ids (design §Collections lens). Owned-only: WHERE scopes to owned=true, collection_id IS NOT NULL. Selects limit+1; overflow group surfaces as nextGroup. */
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

/** Fetches rows for preview ids in indexed read. Returns arbitrary order; service re-orders by (sortTitle, id). Scoped to user's owned rows to prevent cross-tenant leak (design §Architecture). */
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

/** Correlated subquery: inner selects PREVIEW_LIMIT ids ordered (sort_title, id), outer group_concat on PREVIEW_SEP. Binds user_id to use index. */
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

/** Filter axes re-expressed for inner_li subquery so preview honors same filters as count (prevents preview from surfacing excluded titles). */
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

/** Keyset predicate: groups strictly after (collectionName, collectionId); columns match ORDER BY for stable boundaries. */
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

/** Splits limit+1 over-fetch: trailing group is nextGroup (LAST RETURNED, not overflow, to avoid skip when predicate is strictly-greater). */
function toCollectionsPage(groups: CollectionGroup[], limit: number): CollectionsPage {
  if (groups.length <= limit) return { groups };
  const page = groups.slice(0, limit);
  return { groups: page, nextGroup: page[page.length - 1]! };
}
