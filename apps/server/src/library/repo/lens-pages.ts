import { and, asc, eq, gt, inArray, or, sql, type Column, type SQL } from "drizzle-orm";
import type { MediaType } from "@nama/shared/media";
import { QUALITY_RANK_UNRANKED, QUALITY_TIERS, type WatchedState } from "@nama/shared/library";
import { getDb, type Db } from "../../db/client";
import { libraryItems } from "../../db/schema/library";
import type { ExpandedLibraryRow, LibraryRow } from "../types";

/** Filter axes shared by lenses and facets. Empty axis → no filter (design §Shared pkg).
 * `kinds` filters `media_type` directly; `genres`/`qualities`/`servers` match JSON
 * via `json_each` membership; `watched` filters `watched_state`. */
export interface LensFilters {
  kinds?: MediaType[];
  genres?: string[];
  qualities?: string[];
  servers?: string[];
  watched?: WatchedState[];
}

/** Keyset resume position for the A–Z lens: the last page's `(sortTitle, id)`. */
export interface AzCursor {
  sortTitle: string;
  id: string;
}

/** Keyset resume position for the Timeline lens: the last page's `(year, id)`. */
export interface TimelineCursor {
  /** A row with a null `year` is paged as `0` so the keyset stays total. */
  year: number;
  id: string;
}

/** Keyset resume position for Server lens: `(sectionId, sortTitle, id)` from the
 * last expanded row. `sectionId` is the server connection id (unique per expanded row). */
export interface ServerCursor {
  sectionId: string;
  sortTitle: string;
  id: string;
}

/** Keyset resume position for Quality lens: `(tierRank, sortTitle, id)` from last
 * expanded row. `tierRank` = `ORDER BY CASE` ordinal (reused in cursor, never
 * re-derived) so page boundary is stable across tier sections. */
export interface QualityCursor {
  tierRank: number;
  sortTitle: string;
  id: string;
}

/** One page of rows plus the raw keyset token the pipeline mints the next cursor from. */
interface LensPage {
  rows: LibraryRow[];
  /** The last row when the page was full, so the source can build `nextRaw`; absent when exhausted. */
  nextRow?: LibraryRow;
}

/** One page of `json_each`-expanded rows for section-grouped lenses (server/quality).
 * Each row is a `LibraryRow` plus its section value; `nextRow` carries section value
 * so caller can build section-keyed hop token. */
interface ExpandedLensPage {
  rows: ExpandedLibraryRow[];
  nextRow?: ExpandedLibraryRow;
}

/**
 * The browse-projection columns every lens selects, mapped onto `LibraryRow`.
 * Exported so the collections repo selects the SAME shape when it hydrates a
 * group's preview rows (one source of truth for the `LibraryRow` projection).
 */
export const ROW_COLUMNS = {
  id: libraryItems.id,
  tmdbId: libraryItems.tmdbId,
  mediaType: libraryItems.mediaType,
  sortTitle: libraryItems.sortTitle,
  year: libraryItems.year,
  genres: libraryItems.genres,
  servers: libraryItems.servers,
  qualityTiers: libraryItems.qualityTiers,
  watchedState: libraryItems.watchedState,
  collectionId: libraryItems.collectionId,
  collectionName: libraryItems.collectionName,
};

/** Pages A–Z lens in `(sort_title, id)` keyset order (design §The 5 lenses).
 * Selects `limit + 1` rows; extra row surfaced as `nextRow` for next-page detection.
 * SQL pre-sorts, so pipeline uses `sort: "none"`. */
export async function selectAzPage(
  userId: string,
  filters: LensFilters,
  cursor: AzCursor | undefined,
  limit: number,
  db: Db = getDb(),
): Promise<LensPage> {
  const where = and(...ownedFilterConditions(userId, filters), ...azCursorCondition(cursor));
  const rows = await db
    .select(ROW_COLUMNS)
    .from(libraryItems)
    .where(where)
    .orderBy(asc(libraryItems.sortTitle), asc(libraryItems.id))
    .limit(limit + 1);
  return toLensPage(rows, limit);
}

/** Pages Timeline lens in `(year DESC, id)` keyset order. Null `year` sorts last
 * and pages as `0` (keyset stays total). Filters in SQL, `limit + 1` over-fetch,
 * pipeline uses `sort: "none"`. */
export async function selectTimelinePage(
  userId: string,
  filters: LensFilters,
  cursor: TimelineCursor | undefined,
  limit: number,
  db: Db = getDb(),
): Promise<LensPage> {
  const where = and(...ownedFilterConditions(userId, filters), ...timelineCursorCondition(cursor));
  const rows = await db
    .select(ROW_COLUMNS)
    .from(libraryItems)
    .where(where)
    // SAME `COALESCE(year, 0)` as cursor predicate so sort and keyset agree on
    // null-year position. Raw `year DESC` would disagree and silently drop/duplicate
    // rows at the boundary.
    .orderBy(sql`COALESCE(${libraryItems.year}, 0) DESC`, asc(libraryItems.id))
    .limit(limit + 1);
  return toLensPage(rows, limit);
}

/** Base WHERE for every lens: user's owned rows filtered by requested axes.
 * Exported so collections repo applies IDENTICAL predicate before `collection_id IS NOT NULL` grouping. */
export function ownedFilterConditions(userId: string, filters: LensFilters): SQL[] {
  const conditions: SQL[] = [eq(libraryItems.userId, userId), eq(libraryItems.owned, true)];
  if (filters.kinds && filters.kinds.length > 0) {
    conditions.push(inArray(libraryItems.mediaType, filters.kinds));
  }
  if (filters.watched && filters.watched.length > 0) {
    conditions.push(inArray(libraryItems.watchedState, filters.watched));
  }
  if (filters.genres && filters.genres.length > 0) {
    conditions.push(jsonValueIn(libraryItems.genres, filters.genres));
  }
  if (filters.qualities && filters.qualities.length > 0) {
    conditions.push(jsonValueIn(libraryItems.qualityTiers, filters.qualities));
  }
  if (filters.servers && filters.servers.length > 0) {
    conditions.push(jsonServerLabelIn(libraryItems.servers, filters.servers));
  }
  return conditions;
}

/** Renders `values` as `(?, ?, …)` with bound parameters. Drizzle's `sql` template
 * doesn't auto-expand arrays, so `sql.join` builds it explicitly. */
export function inList(values: string[]): SQL {
  return sql`(${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`;
}

/** `EXISTS` membership over JSON string-array: keeps row when any `json_each` value
 * is in `values`. Used for `genres` and `quality_tiers`. */
function jsonValueIn(column: Column, values: string[]): SQL {
  return sql`EXISTS (SELECT 1 FROM json_each(${column}) WHERE value IN ${inList(values)})`;
}

/** `EXISTS` membership over `servers` JSON (elements are `{ id, label }` objects).
 * Matches on `label` (filter axis): facets repo keys on `label`, FE sends `label`
 * back as `filters.servers`, so facet/filter/predicate agree. Server lens SECTIONS
 * on `id` separately. */
function jsonServerLabelIn(column: Column, values: string[]): SQL {
  return sql`EXISTS (SELECT 1 FROM json_each(${column}) WHERE value ->> 'label' IN ${inList(values)})`;
}

/** Keyset predicate for the A–Z lens: rows strictly after `(sortTitle, id)`. */
function azCursorCondition(cursor: AzCursor | undefined): SQL[] {
  if (!cursor) return [];
  return [
    or(
      gt(libraryItems.sortTitle, cursor.sortTitle),
      and(eq(libraryItems.sortTitle, cursor.sortTitle), gt(libraryItems.id, cursor.id)),
    )!,
  ];
}

/** Keyset predicate for Timeline lens: rows strictly after `(year DESC, id)`.
 * Null `year` compares as `0` via `COALESCE` so keyset stays total. */
function timelineCursorCondition(cursor: TimelineCursor | undefined): SQL[] {
  if (!cursor) return [];
  const yearExpr = sql`COALESCE(${libraryItems.year}, 0)`;
  return [
    or(
      sql`${yearExpr} < ${cursor.year}`,
      and(sql`${yearExpr} = ${cursor.year}`, gt(libraryItems.id, cursor.id)),
    )!,
  ];
}

/** Splits `limit + 1` over-fetch into page rows plus next-page marker.
 * Last row dropped and surfaced as `nextRow` when more than `limit` rows. */
function toLensPage(rows: LibraryRow[], limit: number): LensPage {
  if (rows.length <= limit) return { rows };
  // Encode last RETURNED row as next cursor (not overflow): keyset is strictly-greater,
  // so overflow would be skipped on next page. Last returned row resumes exactly at overflow.
  const page = rows.slice(0, limit);
  return { rows: page, nextRow: page[page.length - 1]! };
}

/** Browse columns as table-qualified raw SQL for grouped lenses with raw `FROM`.
 * Drizzle rejects bare column objects when `FROM` is raw SQL. Qualified names
 * avoid "table is not part of query" error and `json_each` `id` ambiguity. */
const EXPANDED_ROW_COLUMNS = {
  id: sql<string>`${libraryItems}."id"`.as("id"),
  tmdbId: sql<string>`${libraryItems}."tmdb_id"`.as("tmdb_id"),
  mediaType: sql<LibraryRow["mediaType"]>`${libraryItems}."media_type"`.as("media_type"),
  sortTitle: sql<string>`${libraryItems}."sort_title"`.as("sort_title"),
  year: sql<number | null>`${libraryItems}."year"`.as("year"),
  genres: sql<string[]>`${libraryItems}."genres"`.as("genres"),
  servers: sql<LibraryRow["servers"]>`${libraryItems}."servers"`.as("servers"),
  qualityTiers: sql<string[]>`${libraryItems}."quality_tiers"`.as("quality_tiers"),
  watchedState: sql<LibraryRow["watchedState"]>`${libraryItems}."watched_state"`.as(
    "watched_state",
  ),
  collectionId: sql<string | null>`${libraryItems}."collection_id"`.as("collection_id"),
  collectionName: sql<string | null>`${libraryItems}."collection_name"`.as("collection_name"),
};

/** Expanded-row columns for Server lens: table-qualified browse columns plus
 * `json_each` value as `sectionId`/`sectionLabel`. Quality lens overrides these. */
const SERVER_ROW_COLUMNS = {
  ...EXPANDED_ROW_COLUMNS,
  sectionId: sql<string>`sv.value ->> 'id'`.as("section_id"),
  sectionLabel: sql<string>`sv.value ->> 'label'`.as("section_label"),
};

/** Pages Server lens in `(server, sort_title, id)` keyset order, expanding each
 * row across `json_each(servers)` (design §The 5 lenses; row dup per value INTENDED).
 * Keyset predicate reuses `ORDER BY` expressions exactly, ensuring stable page boundaries. */
export async function selectServerPage(
  userId: string,
  filters: LensFilters,
  cursor: ServerCursor | undefined,
  limit: number,
  db: Db = getDb(),
): Promise<ExpandedLensPage> {
  const sectionId = sql`sv.value ->> 'id'`;
  const where = and(
    ...ownedFilterConditions(userId, filters),
    ...serverCursorCondition(cursor, sectionId),
  );
  const rows = await db
    .select(SERVER_ROW_COLUMNS)
    .from(sql`${libraryItems}, json_each(${libraryItems.servers}) sv`)
    .where(where)
    .orderBy(sql`${sectionId} ASC`, asc(libraryItems.sortTitle), asc(libraryItems.id))
    .limit(limit + 1);
  return toExpandedPage(rows.map(toServerExpandedRow), limit);
}

/** Pages Quality lens in `(tierRank DESC-fidelity, sort_title, id)` keyset order,
 * expanding across `json_each(quality_tiers)`. Tier rank = `QUALITY_TIERS` ordinal
 * via `CASE`; keyset predicate reuses identical expression (phase-2 lesson: stable
 * tier boundaries, row dup per tier INTENDED). */
export async function selectQualityPage(
  userId: string,
  filters: LensFilters,
  cursor: QualityCursor | undefined,
  limit: number,
  db: Db = getDb(),
): Promise<ExpandedLensPage> {
  // ONE rank `CASE` shared by `ORDER BY` and cursor predicate for byte-identical
  // comparison (phase-2 lesson). Separate `.as()`-aliased rank so row carries ordinal.
  const rank = qualityRankCase();
  const where = and(
    ...ownedFilterConditions(userId, filters),
    ...qualityCursorCondition(cursor, rank),
  );
  const rows = await db
    .select({
      ...EXPANDED_ROW_COLUMNS,
      tier: sql<string>`qt.value`.as("tier"),
      rank: sql<number>`${qualityRankCase()}`.as("tier_rank"),
    })
    .from(sql`${libraryItems}, json_each(${libraryItems.qualityTiers}) qt`)
    .where(where)
    .orderBy(sql`${rank} ASC`, asc(libraryItems.sortTitle), asc(libraryItems.id))
    .limit(limit + 1);
  return toExpandedPage(rows.map(toQualityExpandedRow), limit);
}

/** Keyset predicate for Server lens: expanded rows strictly after
 * `(sectionId, sortTitle, id)`. `sectionId` = `ORDER BY` expression exactly. */
function serverCursorCondition(cursor: ServerCursor | undefined, sectionId: SQL): SQL[] {
  if (!cursor) return [];
  const afterSection = sql`${sectionId} > ${cursor.sectionId}`;
  const sameSection = sql`${sectionId} = ${cursor.sectionId}`;
  return [or(afterSection, and(sameSection, ...afterSortTitle(cursor)))!];
}

/** Keyset predicate for Quality lens: expanded rows strictly after
 * `(tierRank, sortTitle, id)` in ascending-rank order. Rank = identical `ORDER BY` `CASE`. */
function qualityCursorCondition(cursor: QualityCursor | undefined, rank: SQL): SQL[] {
  if (!cursor) return [];
  const afterRank = sql`${rank} > ${cursor.tierRank}`;
  const sameRank = sql`${rank} = ${cursor.tierRank}`;
  return [or(afterRank, and(sameRank, ...afterSortTitle(cursor)))!];
}

/** Shared `(sortTitle, id)` tail of grouped-lens keyset predicates.
 * Both grouped lenses tie-break on ascending `(sort_title, id)`. */
function afterSortTitle(cursor: { sortTitle: string; id: string }): SQL[] {
  return [
    or(
      gt(libraryItems.sortTitle, cursor.sortTitle),
      and(eq(libraryItems.sortTitle, cursor.sortTitle), gt(libraryItems.id, cursor.id)),
    )!,
  ];
}

/** Builds Quality lens rank `CASE` from `QUALITY_TIERS` (one arm per tier + `ELSE`
 * sentinel). Tier labels are compile-time constants (injection-safe). */
function qualityRankCase(): SQL {
  const arms = QUALITY_TIERS.map((label, index) => sql`WHEN ${label} THEN ${index}`);
  return sql`CASE qt.value ${sql.join(arms, sql` `)} ELSE ${QUALITY_RANK_UNRANKED} END`;
}

/** Maps a Server-lens query row onto an `ExpandedLibraryRow` (section ← server `{id,label}`). */
function toServerExpandedRow(
  row: LibraryRow & { sectionId: string; sectionLabel: string },
): ExpandedLibraryRow {
  const { sectionId, sectionLabel, ...base } = row;
  return { ...base, section: { id: sectionId, label: sectionLabel } };
}

/** Maps Quality-lens query row onto `ExpandedLibraryRow`. Tier label = section
 * id and label. Rank rides along for hop token (reuses SQL `CASE` ordinal). */
function toQualityExpandedRow(
  row: LibraryRow & { tier: string; rank: number },
): ExpandedLibraryRow {
  const { tier, rank, ...base } = row;
  return { ...base, section: { id: tier, label: tier }, rank };
}

/** Expanded-row twin of {@link toLensPage}: drops `limit + 1` overflow row,
 * returns last returned row as `nextRow`. Keyset tuple unique per expanded row
 * (phase-2: never encode overflow row; applies to EXPANDED row, not title). */
function toExpandedPage(rows: ExpandedLibraryRow[], limit: number): ExpandedLensPage {
  if (rows.length <= limit) return { rows };
  const page = rows.slice(0, limit);
  return { rows: page, nextRow: page[page.length - 1]! };
}
