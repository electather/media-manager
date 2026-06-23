import { and, eq, sql, type Column, type SQL } from "drizzle-orm";
import type { MediaType } from "@nama/shared/media";
import type { LibraryFacetCounts, WatchedState } from "@nama/shared/library";
import { getDb, type Db } from "../../db/client";
import { libraryItems } from "../../db/schema/library";

/** One `value → count` aggregation row returned by a GROUP BY. */
interface CountRow {
  value: string | null;
  count: number;
}

/**
 * Unfiltered facet totals (design §Facets): whole-library counts, NOT filter-aware.
 * Multi-valued axes (`genres`/`qualities`/`servers`) expand via `json_each` so a
 * title on two servers contributes to both; scoped to `owned = true` to skip tombstones.
 */
export async function selectFacets(userId: string, db: Db = getDb()): Promise<LibraryFacetCounts> {
  const [kinds, genres, qualities, servers, watched, letters, decades] = await Promise.all([
    countByColumn(db, userId, sql`${libraryItems.mediaType}`),
    countByJsonValue(db, userId, libraryItems.genres),
    countByJsonValue(db, userId, libraryItems.qualityTiers),
    countByServerLabel(db, userId),
    countByColumn(db, userId, sql`${libraryItems.watchedState}`),
    selectLetters(db, userId),
    selectDecades(db, userId),
  ]);
  return {
    kinds: rowsToMap(kinds) as Record<MediaType, number>,
    genres: rowsToMap(genres),
    qualities: rowsToMap(qualities),
    servers: rowsToMap(servers),
    watched: rowsToMap(watched) as Record<WatchedState, number>,
    letters,
    decades,
  };
}

/** `GROUP BY <expr>` over the owned set, dropping null buckets (e.g. unset `watched_state`). */
async function countByColumn(db: Db, userId: string, expr: SQL): Promise<CountRow[]> {
  return db
    .select({ value: sql<string>`${expr}`.as("value"), count: sql<number>`count(*)`.as("count") })
    .from(libraryItems)
    .where(and(eq(libraryItems.userId, userId), eq(libraryItems.owned, true)))
    .groupBy(expr);
}

/**
 * `GROUP BY value` over a JSON string-array column expanded with `json_each`,
 * scoped to the owned set. Used for `genres` and `quality_tiers`: a row with two
 * genres contributes one count to each genre bucket.
 */
async function countByJsonValue(db: Db, userId: string, column: Column): Promise<CountRow[]> {
  // `count(DISTINCT id)` (not `count(*)`): a row whose JSON array repeats a
  // value (e.g. dirty metadata returning ["Drama","Drama"]) must count once
  // for that bucket, since a facet is a title count, not an array-element count.
  // The `id` reference is table-qualified because the `json_each` virtual table
  // in the FROM clause also exposes an `id` column, so a bare `id` is ambiguous.
  return db
    .select({
      value: sql<string>`je.value`.as("value"),
      count: sql<number>`count(DISTINCT ${libraryItems}."id")`.as("count"),
    })
    .from(sql`${libraryItems}, json_each(${column}) je`)
    .where(and(eq(libraryItems.userId, userId), eq(libraryItems.owned, true)))
    .groupBy(sql`je.value`);
}

/**
 * `GROUP BY` over `servers` JSON column elements `{ id, label }`. Facet keys on
 * human-readable `label` so badge reads "Plex (12)" not opaque connection id.
 */
async function countByServerLabel(db: Db, userId: string): Promise<CountRow[]> {
  return db
    .select({
      value: sql<string>`je.value ->> 'label'`.as("value"),
      // Table-qualified `id`: the `json_each` virtual table also exposes an `id`
      // column, so a bare `id` here is ambiguous to SQLite.
      count: sql<number>`count(DISTINCT ${libraryItems}."id")`.as("count"),
    })
    .from(sql`${libraryItems}, json_each(${libraryItems.servers}) je`)
    .where(and(eq(libraryItems.userId, userId), eq(libraryItems.owned, true)))
    .groupBy(sql`je.value ->> 'label'`);
}

/**
 * Distinct first characters for A–Z rail, uppercased; non-alphabetic + empty
 * `sort_title` fold to `"#"`. Present-only (letters with no owned title omitted).
 * Sorted with `"#"` trailing.
 */
async function selectLetters(db: Db, userId: string): Promise<string[]> {
  // `substr(sort_title, 1, 1)` is empty-safe (returns "" for a blank title),
  // which the `#` fold below maps to the catch-all bucket.
  const rows = await db
    .selectDistinct({ first: sql<string>`substr(${libraryItems.sortTitle}, 1, 1)`.as("first") })
    .from(libraryItems)
    .where(and(eq(libraryItems.userId, userId), eq(libraryItems.owned, true)));
  const letters = new Set<string>();
  for (const { first } of rows) {
    const upper = first.toUpperCase();
    letters.add(/^[A-Z]$/u.test(upper) ? upper : "#");
  }
  return [...letters].sort((a, b) => {
    if (a === "#") return 1;
    if (b === "#") return -1;
    return a.localeCompare(b);
  });
}

/**
 * The distinct decades present on the timeline rail, newest first (e.g.
 * `[2020, 2010]`). Present-only and derived as `floor(year / 10) * 10`; rows
 * with a null `year` contribute no decade.
 */
async function selectDecades(db: Db, userId: string): Promise<number[]> {
  const rows = await db
    .selectDistinct({
      decade: sql<number>`(${libraryItems.year} / 10) * 10`.as("decade"),
    })
    .from(libraryItems)
    .where(
      and(
        eq(libraryItems.userId, userId),
        eq(libraryItems.owned, true),
        sql`${libraryItems.year} IS NOT NULL`,
      ),
    );
  return rows.map((row) => row.decade).sort((a, b) => b - a);
}

/** Collapses count rows into a `value → count` map, dropping null/empty buckets. */
function rowsToMap(rows: CountRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { value, count } of rows) {
    if (value == null || value === "") continue;
    out[value] = count;
  }
  return out;
}
