import type { DiscoverFeedKind, DiscoverSort } from "@ent-mcp/shared/catalog";
import type { MediaSource } from "../../media";
import type { MediaKey } from "../rows/_shared";

/** UTC midnight epoch ms — keys the day-bucketed `discover_snapshots` table. */
function todayBucket(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Catalog discovery source (design §H/§M.5). Reimplements the `trendingNow` /
 * `newReleases` rows as a `MediaSource`: `fetchRawSet` returns the FULL
 * day-bucketed snapshot as raw `{ tmdbId, type }` keys in feed order and
 * nothing else (invariant V.MC1). The per-row slice + offset cursor that lived
 * in `rows/discover-snapshot.ts` move to the shared pipeline (`paginate`,
 * offset mode); the catalog metadata projection happens home-side after the
 * source.
 *
 * The catalog is the source of truth for these feeds, so the source never
 * partials — an empty or absent snapshot yields zero rows and the consumer
 * envelope drops the row via eligibility (unchanged).
 */
export function discoverSnapshotSource(config: {
  sourceId: string;
  feedKind: DiscoverFeedKind;
  sort: DiscoverSort;
}): MediaSource<void, MediaKey> {
  return {
    sourceId: config.sourceId,
    async fetchRawSet(ctx) {
      const snap = await ctx.catalog.getDiscoverFeed(config.feedKind, config.sort, todayBucket());
      if (!snap) return { rows: [], partial: false };
      return { rows: snap.map((k) => ({ tmdbId: k.tmdbId, type: k.type })), partial: false };
    },
    // `"none"`: the snapshot is already ranked by the persisted sort, so the
    // pipeline must preserve its order. Offset: discovery feeds page by index.
    stages: { sort: "none", cursorMode: "offset" },
  };
}

/** `(trending, popularity_desc, day)` snapshot — the `trendingNow` row. */
export const trendingNowSource = discoverSnapshotSource({
  sourceId: "trendingNow",
  feedKind: "trending",
  sort: "popularity_desc",
});

/**
 * `(newReleases, popularity_desc, day)` snapshot — the `newReleases` row.
 * `popularity_desc` is the only sort the `discover-snapshot` job persists for
 * this feed (matches `rows/new-releases.ts`).
 */
export const newReleasesSource = discoverSnapshotSource({
  sourceId: "newReleases",
  feedKind: "newReleases",
  sort: "popularity_desc",
});
