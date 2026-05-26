import { keyToId, type WatchlistKey } from "@ent-mcp/shared/watchlist";
import { allKnownKeys, bulkInsertActiveRows, clearSeedLock, trySeedLock } from "../../media";
import { toWatchlistKey } from "../internal/watchlist-key";
import { asWatchlistContext, type MaybeRowContext } from "./context";

export interface SeedResult {
  added: number;
  partial: boolean;
}

/**
 * Pulls the plugin watchlist feed and bulk-inserts new items. Serializes
 * concurrent first GETs via `trySeedLock` so only the winning caller fans
 * out to plugins; losers short-circuit with `added: 0`. On a plugin error
 * the lock is rolled back so the next GET retries.
 */
export async function seedFromPlugins(ctx: MaybeRowContext): Promise<SeedResult> {
  const c = asWatchlistContext(ctx);
  const now = Date.now();
  const wonLock = await trySeedLock(c.userId, now);
  if (!wonLock) {
    return { added: 0, partial: false };
  }
  let feed: { items: unknown[]; partial: boolean };
  try {
    const opts: { deadlineMs?: number } = {};
    if (c.deadlineMs != null) opts.deadlineMs = c.deadlineMs;
    feed = await c.mediaService.getWatchlistFeed(opts);
  } catch (err) {
    c.log.warn("[watchlist:seed] getWatchlistFeed threw", err);
    await clearSeedLock(c.userId).catch(() => {});
    return { added: 0, partial: true };
  }
  const keys = (feed.items as unknown[])
    .map(toWatchlistKey)
    .filter((k): k is WatchlistKey => k !== null);
  const known = await allKnownKeys(c.userId);
  const fresh = keys.filter((k) => !known.has(keyToId(k)));
  const added = await bulkInsertActiveRows(c.userId, fresh, "plugin", true, now);
  if (feed.partial) {
    await clearSeedLock(c.userId).catch(() => {});
  }
  return { added, partial: feed.partial };
}

/**
 * Periodic merge for already-seeded users. Diffs the plugin feed against
 * `allKnownKeys` so removed items never resurrect.
 */
export async function syncFromPlugins(ctx: MaybeRowContext): Promise<SeedResult> {
  const c = asWatchlistContext(ctx);
  let feed: { items: unknown[]; partial: boolean };
  try {
    const opts: { deadlineMs?: number } = {};
    if (c.deadlineMs != null) opts.deadlineMs = c.deadlineMs;
    feed = await c.mediaService.getWatchlistFeed(opts);
  } catch (err) {
    c.log.warn("[watchlist:sync] getWatchlistFeed threw", err);
    return { added: 0, partial: true };
  }
  const keys = (feed.items as unknown[])
    .map(toWatchlistKey)
    .filter((k): k is WatchlistKey => k !== null);
  const known = await allKnownKeys(c.userId);
  const fresh = keys.filter((k) => !known.has(keyToId(k)));
  const now = Date.now();
  const added = await bulkInsertActiveRows(c.userId, fresh, "plugin", false, now);
  return { added, partial: feed.partial };
}
