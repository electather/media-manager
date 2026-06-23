import type { DiscoverFeedKind, DiscoverSort } from "@nama/shared/catalog";
import type { MediaSource } from "../../media";
import type { MediaKey } from "../rows/_shared";

/** UTC midnight epoch ms — keys the day-bucketed `discover_snapshots` table. */
export function todayBucket(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// Catalog discovery source (design §H/§M.5) reimplements trendingNow/
// newReleases as MediaSource. fetchRawSet returns day-bucketed snapshot as
// {tmdbId, type} keys in feed order only (V.MC1). Per-row cursor moved to
// shared pipeline (paginate, offset). Never partials: empty snapshot → zero
// rows → dropped via eligibility.
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
