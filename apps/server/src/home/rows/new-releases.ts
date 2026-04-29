import type { RowKind } from "@ent-mcp/shared/home";
import type { RowFetcher, RowFetchContext, RowFetchOptions, RowFetchResult } from "./index";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import type { CanonicalMetadata, MetadataKey } from "../../catalog/types";
import { encodeCursor } from "../cursor";
import { canonicalToRaw, type RawMediaItem } from "../compact";
import { buildItem } from "./build-item";
import { readPage } from "./row-utils";
import { isNil } from "es-toolkit/predicate";

const ROW_ID = "newReleases" as const satisfies RowKind;
const MAX_ITEMS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `metadata@v1.discover` with a recent-release filter. Always eligible —
 * even a TMDB-only install renders this row. The catalog's daily
 * discover snapshot is consulted first; on a snapshot miss the row falls
 * back to the live plugin path so behavior stays identical pre-warm.
 */
export const newReleasesFetcher: RowFetcher = {
  rowId: ROW_ID,
  title: "New Releases",
  requires: ["metadata@v1"],

  async fetch(ctx: RowFetchContext, opts: RowFetchOptions): Promise<RowFetchResult> {
    const page = readPage(opts.cursor, ROW_ID);
    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;

    const snapshot = await ctx.catalogService.getDiscoverFeed(
      "newReleases",
      "popularity_desc",
      today,
    );
    if (snapshot && snapshot.length > 0) {
      return hydrateFromSnapshot(ctx, snapshot, page, opts.limit);
    }

    return fetchFromLivePath(ctx, page, opts.limit, today);
  },

  async isEligible(): Promise<boolean> {
    // Always eligible: `metadata@v1` is assumed present (admin TMDB key in
    // the shared pool); when absent the fetch empties out and pagination
    // ends gracefully — no `home.row_unavailable`.
    return true;
  },
};

// fallow-ignore-next-line complexity
async function hydrateFromSnapshot(
  ctx: RowFetchContext,
  refs: MetadataKey[],
  page: number,
  limit: number,
): Promise<RowFetchResult> {
  const start = page * limit;
  const slice = refs.slice(start, start + limit);
  if (slice.length === 0) {
    return { items: [], cursor: null };
  }
  const rows = await ctx.catalogService.getMetadataBatch(slice);
  const hydrated: Array<CanonicalMetadata | null> = slice.map(
    (ref) => rows[`${ref.type}:${ref.tmdbId}`] ?? null,
  );
  const isPartial = hydrated.some(isNil);
  const present = hydrated.filter((row): row is CanonicalMetadata => row !== null);

  const items = await Promise.all(present.map((row) => buildFromCanonical(ctx, row)));
  const usable = items.filter((item): item is CompactMediaItem => item !== null);

  const nextStart = start + limit;
  const reachedCap = nextStart >= MAX_ITEMS;
  const exhausted = nextStart >= refs.length;
  const cursor =
    exhausted || reachedCap || usable.length === 0
      ? null
      : encodeCursor(ROW_ID, { v: 1, r: ROW_ID, p: page + 1 });
  return isPartial ? { items: usable, cursor, partial: true } : { items: usable, cursor };
}

async function fetchFromLivePath(
  ctx: RowFetchContext,
  page: number,
  limit: number,
  today: number,
): Promise<RowFetchResult> {
  // Round to the calendar day so the dispatcher's 24h positive cache key
  // is stable across requests within the same day. The upper bound is
  // `today + DAY_MS` (exclusive end-of-day) so titles released today are
  // still visible — switching to `today` would silently hide them.
  const result = await ctx.mediaService.discoverFeed({
    limit: limit * (page + 1),
    releaseDateGte: today - 90 * DAY_MS,
    releaseDateLte: today + DAY_MS,
    sort: "popularity_desc",
    deadlineMs: ctx.deadlineMs,
  });

  const merged = (result.items as RawMediaItem[]).slice(page * limit, (page + 1) * limit);
  const items = await Promise.all(merged.map((item) => buildItem(ctx, item)));
  const usable = items.filter((item): item is CompactMediaItem => item !== null);

  const nextPage = page + 1;
  const reachedCap = nextPage * limit >= MAX_ITEMS;
  const cursor =
    usable.length === 0 || reachedCap || merged.length < limit
      ? null
      : encodeCursor(ROW_ID, { v: 1, r: ROW_ID, p: nextPage });
  return result.partial ? { items: usable, cursor, partial: true } : { items: usable, cursor };
}

async function buildFromCanonical(
  ctx: RowFetchContext,
  row: CanonicalMetadata,
): Promise<CompactMediaItem | null> {
  return buildItem(ctx, canonicalToRaw(row));
}
