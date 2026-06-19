import { and, asc, eq, gt, inArray, or, sql, type Column, type SQL } from "drizzle-orm";
import type { MediaType } from "@nama/shared/media";
import { QUALITY_TIERS, type WatchedState } from "@nama/shared/library";
import { QUALITY_RANK_UNRANKED } from "../internal/rank-quality";
import { getDb, type Db } from "../../db/client";
import { libraryItems } from "../../db/schema/library";
import type { ExpandedLibraryRow, LibraryRow } from "../types";

/**
 * The filter axes the lens pages and facets share, parsed off
 * `libraryLensQuerySchema`. Every axis is optional: an omitted or empty axis
 * applies no filter (design §Shared pkg: "Empty axis → no filter"). `kinds`
 * filters the `media_type` column directly; `genres`/`qualities`/`servers`
 * match the multi-valued JSON columns via `json_each` membership; `watched`
 * filters the `watched_state` column.
 */
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

/**
 * Keyset resume position for the Server lens: the last expanded row's
 * `(sectionId, sortTitle, id)`. `sectionId` is the server connection id the row
 * expanded into via `json_each`; the same title resumes correctly even though it
 * appears once per server because the tuple is unique per expanded row.
 */
export interface ServerCursor {
  sectionId: string;
  sortTitle: string;
  id: string;
}

/**
 * Keyset resume position for the Quality lens: the last expanded row's
 * `(tierRank, sortTitle, id)`. `tierRank` is the SAME ordinal the `ORDER BY`
 * `CASE` produced (the `QUALITY_TIERS` index, or the bottom sentinel for an
 * unlisted label), so the resume comparison reuses the identical rank expression
 * — never a re-derived one — and a page boundary neither drops nor duplicates a
 * tier section.
 */
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

/**
 * One page of `json_each`-EXPANDED rows for the section-grouped lenses
 * (server/quality). Each row is a `LibraryRow` plus the section value it
 * expanded into, so the same title appears once per section. `nextRow` carries
 * that section value too so the source can build a section-keyed hop token.
 */
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

/**
 * Pages the A–Z lens in `(sort_title, id)` ascending keyset order over the
 * user's owned set, applying the requested filters in SQL (design §The 5
 * lenses). Selects `limit + 1` rows so the caller can detect a next page without
 * a second count query; the extra row is dropped and surfaced as `nextRow`. The
 * SQL pre-sorts, so the pipeline declares `sort: "none"`.
 */
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

/**
 * Pages the Timeline lens in `(year DESC, id)` keyset order over the user's
 * owned set. A null `year` sorts last (newest-first puts undated titles at the
 * tail) and is paged as `0` in the cursor so the keyset stays total. Otherwise
 * identical to {@link selectAzPage}: filters in SQL, `limit + 1` over-fetch, SQL
 * pre-sorts so the pipeline runs `sort: "none"`.
 */
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
    // Order by the SAME `COALESCE(year, 0)` expression the cursor predicate
    // uses, so the sort and the keyset agree on where a null (or literal 0)
    // year sits — at the descending tail, tie-broken by the stable id. Using
    // raw `year DESC` (SQLite NULLS-last) here would disagree with the
    // COALESCE predicate and silently drop/duplicate undated rows at the page
    // boundary.
    .orderBy(sql`COALESCE(${libraryItems.year}, 0) DESC`, asc(libraryItems.id))
    .limit(limit + 1);
  return toLensPage(rows, limit);
}

/**
 * Base WHERE for every lens: the user's currently-owned rows narrowed by the
 * requested filters. `owned = true` excludes tombstones; an absent/empty axis
 * contributes no condition. Exported so the collections repo applies the
 * IDENTICAL owned + filter predicate before its `collection_id IS NOT NULL`
 * group narrowing — the filter axes behave the same on every lens.
 */
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

/**
 * Renders `values` as a parenthesized SQL `IN` list of bound parameters.
 * Drizzle's `sql` template does NOT auto-expand a JS array into `(?, ?, …)`, so
 * the membership helpers build the list explicitly with `sql.join` — each value
 * stays a bound parameter, never string-interpolated.
 */
export function inList(values: string[]): SQL {
  return sql`(${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `,
  )})`;
}

/**
 * `EXISTS` membership over a JSON string-array column: keeps the row when any
 * `json_each` value is in `values`. Used for `genres` and `quality_tiers`,
 * whose JSON is a flat `["Drama", …]` / `["4K HDR", …]` array.
 */
function jsonValueIn(column: Column, values: string[]): SQL {
  return sql`EXISTS (SELECT 1 FROM json_each(${column}) WHERE value IN ${inList(values)})`;
}

/**
 * `EXISTS` membership over the `servers` JSON column, whose elements are
 * `{ id, label }` objects, matching on each element's human-readable `label`.
 * The label is the filter axis on purpose: the facets repo keys the `servers`
 * count map on `label`, and the FE popover sends that same label back as
 * `filters.servers`, so the facet key, the filter value, and this predicate all
 * agree on the label. (The Server LENS still SECTIONS on the connection `id` for
 * stable grouping — that is a separate axis from this filter.)
 */
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

/**
 * Keyset predicate for the Timeline lens: rows strictly after `(year DESC, id)`.
 * "After" in a descending-year ordering means a smaller year, or the same year
 * with a larger id. A null `year` compares as `0` (its sort position) via
 * `COALESCE` so the resume tuple stays total across the NULLS-last tail.
 */
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

/**
 * Splits the `limit + 1` over-fetch into the page rows plus the next-page
 * marker. When the query returned more than `limit` rows there is another page,
 * so the trailing row is dropped from the page and returned as `nextRow` for the
 * source to encode into the keyset hop token; a short read means the scan is
 * exhausted and no `nextRow` is emitted.
 */
function toLensPage(rows: LibraryRow[], limit: number): LensPage {
  if (rows.length <= limit) return { rows };
  // The next cursor is the LAST row of the RETURNED page, never the dropped
  // overflow row: the keyset predicate is strictly-greater, so encoding the
  // overflow row would skip it on the next page (it is neither in this page nor
  // returned by a `> overflow` scan). Encoding the last returned row makes the
  // next page resume exactly at the overflow row. (Mirrors the watchlist
  // source's `rawToken(rows[rows.length - 1])` convention.)
  const page = rows.slice(0, limit);
  return { rows: page, nextRow: page[page.length - 1]! };
}

/**
 * The browse-projection columns as TABLE-QUALIFIED raw SQL, for the grouped
 * lenses whose `FROM` is a raw `${libraryItems}, json_each(...)` expression.
 * Drizzle's query builder rejects a bare column object (`libraryItems.id`) in a
 * `.select()` when the `FROM` is raw SQL — it cannot tie the column back to a
 * recognized table source and throws "the table is not part of the query". So
 * the grouped lenses project each column as `${libraryItems}."col"`, the same
 * table-qualified convention `facets.ts` uses for its `json_each` counts. The
 * `id` qualification is doubly required: the `json_each` virtual table also
 * exposes an `id`, so a bare `id` would be ambiguous to SQLite.
 */
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

/**
 * The expanded-row columns the Server lens selects: the table-qualified browse
 * columns plus the `json_each` value, aliased so it maps onto
 * `ExpandedLibraryRow`. The `id`/`label` are pulled from the value object for the
 * Server lens; the Quality lens overrides them since its value is a bare string
 * (see below).
 */
const SERVER_ROW_COLUMNS = {
  ...EXPANDED_ROW_COLUMNS,
  sectionId: sql<string>`sv.value ->> 'id'`.as("section_id"),
  sectionLabel: sql<string>`sv.value ->> 'label'`.as("section_label"),
};

/**
 * Pages the Server lens in `(server, sort_title, id)` ascending keyset order,
 * expanding each owned row across `json_each(servers)` so a title on two servers
 * appears in both server sections (design §The 5 lenses; row dup per value is
 * INTENDED). The keyset predicate uses the SAME `sv.value ->> 'id'` /
 * `sort_title` / `id` expressions the `ORDER BY` uses — column-for-column — so a
 * page boundary is stable. Filters apply identically to the flat lenses.
 */
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

/**
 * Pages the Quality lens in `(tierRank DESC-fidelity, sort_title, id)` keyset
 * order, expanding each owned row across `json_each(quality_tiers)`. The tier
 * rank is the `QUALITY_TIERS` ordinal built as a SQL `CASE` ({@link qualityRankCase});
 * the `ORDER BY` sorts it ASCENDING (0 = highest fidelity first) and the keyset
 * predicate reuses the IDENTICAL `CASE` expression — never a re-derived rank —
 * so a tier section is neither dropped nor duplicated at a page boundary
 * (phase-2 lesson). Row dup per tier is INTENDED. Filters apply identically.
 */
export async function selectQualityPage(
  userId: string,
  filters: LensFilters,
  cursor: QualityCursor | undefined,
  limit: number,
  db: Db = getDb(),
): Promise<ExpandedLensPage> {
  // ONE rank `CASE` shared by the `ORDER BY` and the cursor predicate so the
  // sort key and the resume comparison are byte-identical (phase-2 lesson). The
  // select projects a SEPARATE `.as()`-aliased rank so the returned row carries
  // the ordinal for the hop token, without aliasing the shared comparison copy.
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

/**
 * Keyset predicate for the Server lens: expanded rows strictly after
 * `(sectionId, sortTitle, id)`. The `sectionId` arg is the SAME
 * `sv.value ->> 'id'` SQL the caller orders by, so the comparison and the sort
 * never drift.
 */
function serverCursorCondition(cursor: ServerCursor | undefined, sectionId: SQL): SQL[] {
  if (!cursor) return [];
  const afterSection = sql`${sectionId} > ${cursor.sectionId}`;
  const sameSection = sql`${sectionId} = ${cursor.sectionId}`;
  return [or(afterSection, and(sameSection, ...afterSortTitle(cursor)))!];
}

/**
 * Keyset predicate for the Quality lens: expanded rows strictly after
 * `(tierRank, sortTitle, id)` in ASCENDING-rank order (a LARGER rank = lower
 * fidelity = later). The `rank` arg is the identical `CASE` the caller orders
 * by, so a hand-built ordinal never disagrees with the SQL one.
 */
function qualityCursorCondition(cursor: QualityCursor | undefined, rank: SQL): SQL[] {
  if (!cursor) return [];
  const afterRank = sql`${rank} > ${cursor.tierRank}`;
  const sameRank = sql`${rank} = ${cursor.tierRank}`;
  return [or(afterRank, and(sameRank, ...afterSortTitle(cursor)))!];
}

/**
 * The shared `(sortTitle, id)` tail of the grouped-lens keyset predicates: rows
 * after `cursor` once the leading section/rank key ties. Both grouped lenses
 * tie-break on the same ascending `(sort_title, id)`, so they share this.
 */
function afterSortTitle(cursor: { sortTitle: string; id: string }): SQL[] {
  return [
    or(
      gt(libraryItems.sortTitle, cursor.sortTitle),
      and(eq(libraryItems.sortTitle, cursor.sortTitle), gt(libraryItems.id, cursor.id)),
    )!,
  ];
}

/**
 * Builds the Quality lens rank `CASE` from `QUALITY_TIERS`: one arm per tier
 * (`WHEN 'label' THEN <index>`) with the bottom sentinel in the `ELSE`, matching
 * `rankQualityTier` value-for-value. Tier labels are compile-time constants
 * (never user input), so interpolating them is injection-safe; the ordinals are
 * bound parameters.
 */
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

/**
 * Maps a Quality-lens query row onto an `ExpandedLibraryRow`. The tier label is
 * both the section id and label (it is the group key the FE shows verbatim);
 * `rank` rides along so the source's hop token reuses the SQL `CASE` ordinal
 * rather than re-deriving it.
 */
function toQualityExpandedRow(
  row: LibraryRow & { tier: string; rank: number },
): ExpandedLibraryRow {
  const { tier, rank, ...base } = row;
  return { ...base, section: { id: tier, label: tier }, rank };
}

/**
 * The expanded-row twin of {@link toLensPage}: drops the `limit + 1` overflow
 * row and returns the LAST RETURNED expanded row as `nextRow`. The keyset tuple
 * is unique per expanded row (section/rank + sortTitle + id), so encoding the
 * last returned row makes the next page resume exactly at the overflow row — the
 * phase-2 "never encode the overflow row" lesson, applied to the EXPANDED row,
 * not the distinct title.
 */
function toExpandedPage(rows: ExpandedLibraryRow[], limit: number): ExpandedLensPage {
  if (rows.length <= limit) return { rows };
  const page = rows.slice(0, limit);
  return { rows: page, nextRow: page[page.length - 1]! };
}
