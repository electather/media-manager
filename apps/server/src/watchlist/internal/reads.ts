import type { ActiveRow } from "@ent-mcp/shared/media";
import type { WatchlistResponse } from "@ent-mcp/shared/watchlist";
import {
  enrich,
  getMatchingServersCached,
  hasActiveRows,
  hasUserSeeded,
  listActiveRowsKeyset,
  listAvailableCandidates,
  seedFromPlugins as mediaSeedFromPlugins,
  encodeCursor,
  decodeCursor,
} from "../../media";
import { asWatchlistContext, clampLimit, type MaybeRowContext } from "./context";

export interface GetItemsOptions {
  /** Opaque keyset cursor from a previous response. Omit on the first page. */
  cursor?: string;
  /** Page size cap. Defaults to 60, hard-capped at 200 to match the wire schema. */
  limit?: number;
}

/**
 * Keyset-paginated read of the user's active watchlist. First page (no
 * cursor) triggers a plugin seed when the user has never been seeded. This is
 * the basic list read; the filtered/sorted `items` section is `listItems`.
 */
// fallow-ignore-next-line complexity
export async function getItems(
  ctx: MaybeRowContext,
  opts: GetItemsOptions = {},
): Promise<WatchlistResponse> {
  // fallow-ignore-next-line code-duplication
  const c = asWatchlistContext(ctx);
  const limit = clampLimit(opts.limit);
  const cursor = opts.cursor ? decodeCursor(opts.cursor) : undefined;
  let partial = false;

  // Seed only on the *first* page; cursor implies the user already has rows.
  if (!cursor && !(await hasUserSeeded(c.userId))) {
    if (!(await hasActiveRows(c.userId))) {
      const seedRes = await mediaSeedFromPlugins(c);
      partial = partial || seedRes.partial;
    }
  }

  const rows = await listActiveRowsKeyset(c.userId, {
    limit,
    ...(cursor ? { cursor } : {}),
  });
  if (rows.length === 0) {
    return { items: [], cursor: null, partial };
  }
  const enriched = await enrich(rows, c);
  const last = rows[rows.length - 1]!;
  const nextCursor =
    rows.length < limit ? null : encodeCursor({ addedAt: last.addedAt, id: last.id });
  return {
    items: enriched.items,
    cursor: nextCursor,
    partial: partial || enriched.partial,
  };
}

/**
 * Returns up to `limit` active items the user actually has on a connected
 * library server. Pre-filters by `getMatchingServers` before the enrich
 * fan-out so we don't pay the metadata batch for items the user can't play.
 *
 * Triggers a seed when the user has no active rows and has not been seeded
 * yet, then retries once.
 */
// fallow-ignore-next-line complexity
export async function listAvailable(
  limit: number,
  ctx: MaybeRowContext,
): Promise<WatchlistResponse> {
  const c = asWatchlistContext(ctx);
  let partial = false;
  let candidates = await listAvailableCandidates(c.userId, limit * 4);
  if (candidates.length === 0 && !(await hasUserSeeded(c.userId))) {
    const seedRes = await mediaSeedFromPlugins(c);
    partial = partial || seedRes.partial;
    candidates = await listAvailableCandidates(c.userId, limit * 4);
  }
  if (candidates.length === 0) return { items: [], cursor: null, partial };

  // Probe matching servers in parallel — they're per-request memoized inside
  // MediaService, but each fresh key still triggers a plugin call, so a
  // sequential loop turned this into O(N) wall-clock latency on cold caches.
  const probes = await Promise.allSettled(
    candidates.map((row) =>
      getMatchingServersCached(c.userId, c.mediaService, row.tmdbId, row.mediaType),
    ),
  );
  const picked: ActiveRow[] = [];
  for (let i = 0; i < candidates.length; i++) {
    if (picked.length >= limit) break;
    const probe = probes[i]!;
    if (probe.status !== "fulfilled") {
      partial = true;
      continue;
    }
    if (probe.value.length > 0) picked.push(candidates[i]!);
  }
  if (picked.length === 0) return { items: [], cursor: null, partial };

  const enriched = await enrich(picked, c);
  return { items: enriched.items, cursor: null, partial: partial || enriched.partial };
}

export async function hasAny(userId: string): Promise<boolean> {
  return hasActiveRows(userId);
}
