import { and, desc, eq, lt, or } from "drizzle-orm";
import type { WatchlistSource } from "@ent-mcp/shared/watchlist";
import { getDb, type Db } from "../db/client";
import { watchlistItems } from "../db/schema/watchlist";

/**
 * Active-row read repo for media list endpoints (home rails, watchlist
 * buckets, mood scans). Drizzle queries live here; service callers consume
 * the typed shapes below through the media barrel so the storage layer stays
 * isolated from the orchestration surface.
 */

export const ROW_SORTS = ["recent", "alpha"] as const;
export type RowSort = (typeof ROW_SORTS)[number];

export interface ActiveRow {
  id: string;
  userId: string;
  tmdbId: string;
  mediaType: "movie" | "tv";
  state: "active" | "removed";
  source: WatchlistSource;
  addedAt: number;
  removedAt: number | null;
  seeded: boolean;
}

export interface RowFilter {
  state?: "active" | "removed";
}

export interface PageCursor {
  addedAt: number;
  id: string;
}

function toActiveRow(raw: typeof watchlistItems.$inferSelect): ActiveRow {
  return {
    id: raw.id,
    userId: raw.userId,
    tmdbId: raw.tmdbId,
    mediaType: raw.mediaType,
    state: raw.state,
    source: raw.source as WatchlistSource,
    addedAt: raw.addedAt,
    removedAt: raw.removedAt,
    seeded: Boolean(raw.seeded),
  };
}

/**
 * Encode/decode are deliberately url-safe + opaque so clients pass the cursor
 * through verbatim. Base64 of `${addedAt}:${id}` — id is a cuid, so no `:` in
 * either component.
 */
export function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(`${cursor.addedAt}:${cursor.id}`, "utf8").toString("base64url");
}

// fallow-ignore-next-line complexity
export function decodeCursor(raw: string): PageCursor | null {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const idx = decoded.indexOf(":");
    if (idx <= 0) return null;
    const addedAt = Number(decoded.slice(0, idx));
    const id = decoded.slice(idx + 1);
    if (!Number.isFinite(addedAt) || id.length === 0) return null;
    return { addedAt, id };
  } catch {
    return null;
  }
}

/**
 * All rows for the user matching `filter`, newest first. With `opts.limit`
 * the query caps at that many candidates — used by `/watchlist/counts` and
 * the home "your-watchlist" rail.
 */
export async function listActiveRows(
  userId: string,
  opts: RowFilter & { limit?: number; sort?: RowSort } = {},
  db: Db = getDb(),
): Promise<ActiveRow[]> {
  // `sort=alpha` lands in US-009; until then any value falls back to `recent`.
  const state = opts.state ?? "active";
  let query = db
    .select()
    .from(watchlistItems)
    .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.state, state)))
    .orderBy(desc(watchlistItems.addedAt), desc(watchlistItems.id));
  if (opts.limit != null) query = query.limit(opts.limit) as typeof query;
  const rows = await query;
  return rows.map(toActiveRow);
}

/**
 * Keyset-paginated read of active rows in `(added_at DESC, id DESC)` order.
 * Caller asks for `limit` rows past `cursor`. Returns up to `limit` rows;
 * callers slice / re-page based on whether the result was full.
 */
export async function listActiveRowsKeyset(
  userId: string,
  opts: { cursor?: PageCursor; limit: number },
  db: Db = getDb(),
): Promise<ActiveRow[]> {
  const conditions = [eq(watchlistItems.userId, userId), eq(watchlistItems.state, "active")];
  if (opts.cursor) {
    // Strict keyset: rows are sorted (added_at DESC, id DESC), so the next
    // page starts at rows that are *strictly less* than the cursor in that
    // composite key.
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
  return rows.map(toActiveRow);
}

/**
 * Offset-paginated read of active rows for snapshot scans (mood detail,
 * sparse-bucket retries). Same `(added_at DESC, id DESC)` order as the
 * keyset path so a `limit + offset` slice matches the keyset window.
 */
export async function listActiveRowsOffset(
  userId: string,
  opts: { limit: number; offset: number; sort?: RowSort },
  db: Db = getDb(),
): Promise<ActiveRow[]> {
  // `sort=alpha` lands with US-009; until then any value falls back to `recent`.
  const rows = await db
    .select()
    .from(watchlistItems)
    .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.state, "active")))
    .orderBy(desc(watchlistItems.addedAt), desc(watchlistItems.id))
    .limit(opts.limit)
    .offset(opts.offset);
  return rows.map(toActiveRow);
}

export async function getActiveRow(
  userId: string,
  key: { tmdbId: string; mediaType: "movie" | "tv" },
  db: Db = getDb(),
): Promise<ActiveRow | null> {
  const row = await db
    .select()
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, userId),
        eq(watchlistItems.tmdbId, key.tmdbId),
        eq(watchlistItems.mediaType, key.mediaType),
      ),
    )
    .get();
  return row ? toActiveRow(row) : null;
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
