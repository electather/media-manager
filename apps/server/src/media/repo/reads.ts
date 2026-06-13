import { and, desc, eq, lt, or } from "drizzle-orm";
import { keyToId, type WatchlistKey } from "@nama/shared/watchlist";
import type { ActiveRow, RowFilter, RowSort } from "@nama/shared/media";
import { getDb, type Db } from "../../db/client";
import { watchlistItems } from "../../db/schema/media";
import type { PageCursor } from "./cursor";
import { selectRowByKey } from "./internal";
import { toRow } from "./row";

// fallow-ignore-next-line complexity
export async function listActiveRows(
  userId: string,
  opts: { filter?: RowFilter; sort?: RowSort; limit?: number } = {},
  db: Db = getDb(),
): Promise<ActiveRow[]> {
  const state = opts.filter?.state ?? "active";
  const conditions = [eq(watchlistItems.userId, userId), eq(watchlistItems.state, state)];
  if (opts.filter?.mediaType) {
    conditions.push(eq(watchlistItems.mediaType, opts.filter.mediaType));
  }

  const base = db
    .select()
    .from(watchlistItems)
    .where(and(...conditions));

  const ordered =
    opts.sort === "recentAsc"
      ? base.orderBy(watchlistItems.addedAt, watchlistItems.id)
      : base.orderBy(desc(watchlistItems.addedAt), desc(watchlistItems.id));

  const limited = opts.limit != null ? ordered.limit(opts.limit) : ordered;
  const rows = await limited;
  return rows.map(toRow);
}

/**
 * Keyset-paginated read of active rows in `(added_at DESC, id DESC)` order.
 * Returns up to `limit` rows past `cursor`.
 */
export async function listActiveRowsKeyset(
  userId: string,
  opts: { cursor?: PageCursor; limit: number },
  db: Db = getDb(),
): Promise<ActiveRow[]> {
  const conditions = [eq(watchlistItems.userId, userId), eq(watchlistItems.state, "active")];
  if (opts.cursor) {
    conditions.push(
      or(
        lt(watchlistItems.addedAt, opts.cursor.addedAt),
        and(eq(watchlistItems.addedAt, opts.cursor.addedAt), lt(watchlistItems.id, opts.cursor.id)),
      )!,
    );
  }
  const rows = await db
    .select()
    .from(watchlistItems)
    .where(and(...conditions))
    .orderBy(desc(watchlistItems.addedAt), desc(watchlistItems.id))
    .limit(opts.limit);
  return rows.map(toRow);
}

export async function findRowByKey(
  userId: string,
  key: WatchlistKey,
  db: Db = getDb(),
): Promise<ActiveRow | null> {
  const row = await selectRowByKey(db, userId, key);
  return row ? toRow(row) : null;
}

/** Active rows for the user, newest first, optionally capped by `limit`. */
function activeRowsQuery(userId: string, db: Db, limit?: number) {
  const ordered = db
    .select()
    .from(watchlistItems)
    .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.state, "active")))
    .orderBy(desc(watchlistItems.addedAt), desc(watchlistItems.id));
  return limit != null ? ordered.limit(limit) : ordered;
}

/** All active rows for the user, newest first. Used by the section sources + mood derivation. */
export async function listAllActiveRows(userId: string, db: Db = getDb()): Promise<ActiveRow[]> {
  const rows = await activeRowsQuery(userId, db);
  return rows.map(toRow);
}

/** Active rows for the user, newest first, capped by `limit`. Used by availability probing. */
export async function listAvailableCandidates(
  userId: string,
  limit: number,
  db: Db = getDb(),
): Promise<ActiveRow[]> {
  const rows = await activeRowsQuery(userId, db, limit);
  return rows.map(toRow);
}

export async function hasActiveRows(userId: string, db: Db = getDb()): Promise<boolean> {
  const row = await db
    .select({ id: watchlistItems.id })
    .from(watchlistItems)
    .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.state, "active")))
    .limit(1)
    .get();
  return row != null;
}

/**
 * Returns the set of `mediaType:tmdbId` composite ids known for the user in
 * any state. Plugin sync uses this to skip keys the user has already removed.
 */
export async function allKnownKeys(userId: string, db: Db = getDb()): Promise<Set<string>> {
  const rows = await db
    .select({ tmdbId: watchlistItems.tmdbId, mediaType: watchlistItems.mediaType })
    .from(watchlistItems)
    .where(eq(watchlistItems.userId, userId));
  const out = new Set<string>();
  for (const row of rows) out.add(keyToId({ tmdbId: row.tmdbId, mediaType: row.mediaType }));
  return out;
}
