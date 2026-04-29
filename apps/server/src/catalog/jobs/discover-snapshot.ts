import { MediaService } from "../../media/service";
import { splitCombinedId } from "../../media/parse-item";
import { registerScheduled } from "../../jobs/scheduled";
import type { JobRunContext } from "../../jobs/types";
import type { CatalogService } from "../../catalog";
import { toCanonicalRow, type RawCanonicalSource } from "../canonical";
import type { DiscoverFeedKind, DiscoverSort, MetadataKey } from "../types";
import { SYSTEM_USER_ID } from "./constants";

const DAY_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_LIMIT = 60;

export const CATALOG_DISCOVER_SNAPSHOT_JOB_ID = "host.catalog.discover_snapshot";

interface SnapshotTuple {
  kind: DiscoverFeedKind;
  sort: DiscoverSort;
  /**
   * Filter projection passed to `MediaService.discoverFeed`. The metadata
   * plugin has no `kind` knob, so each tuple maps to the equivalent
   * date/sort projection.
   */
  filters: DiscoverFilters;
}

interface DiscoverFilters {
  releaseDateGte?: number;
  releaseDateLte?: number;
  sort: DiscoverSort;
}

const TRENDING_WINDOW_DAYS = 30;

/** Tuples land verbatim on `(feedKind, sort, day)` keys per V42. */
function tuplesForDay(today: number): SnapshotTuple[] {
  return [
    {
      kind: "newReleases",
      sort: "popularity_desc",
      filters: {
        releaseDateGte: today - 90 * DAY_MS,
        releaseDateLte: today + DAY_MS,
        sort: "popularity_desc",
      },
    },
    {
      // Trending = popularity-sorted within a recent-release window so the
      // tuple captures momentum rather than catalog-wide popularity. Without
      // the window the trending and popular tuples would collapse to the
      // same dispatch + same persisted items, which is what the follow-up
      // row reconciliation will need to differentiate.
      kind: "trending",
      sort: "popularity_desc",
      filters: {
        releaseDateGte: today - TRENDING_WINDOW_DAYS * DAY_MS,
        releaseDateLte: today + DAY_MS,
        sort: "popularity_desc",
      },
    },
    {
      kind: "upcoming",
      sort: "release_date_asc",
      filters: { releaseDateGte: today, sort: "release_date_asc" },
    },
    {
      kind: "popular",
      sort: "popularity_desc",
      filters: { sort: "popularity_desc" },
    },
  ];
}

export interface CatalogDiscoverSnapshotDeps {
  catalog: CatalogService;
}

/**
 * Registers the daily discover-snapshot builder. Iterates the four (kind,
 * sort) tuples; for each, calls `metadata@v1.discover` with the matching
 * filter projection, warms `canonical_metadata` via a side-effect
 * `writeMetadata`, and persists the id-only refs onto `discover_snapshots`
 * keyed by `(kind, sort, day)` per V42.
 */
export function registerCatalogDiscoverSnapshotJob(deps: CatalogDiscoverSnapshotDeps): void {
  registerScheduled({
    id: CATALOG_DISCOVER_SNAPSHOT_JOB_ID,
    name: "Catalog discover snapshot",
    description: "Builds the daily discover snapshots used by home-feed discover rows.",
    schedule: "0 6 * * *",
    timeoutSec: 30 * 60,
    adminTriggerable: true,
    handler: (ctx) => runCatalogDiscoverSnapshot(deps, ctx),
  });
}

export async function runCatalogDiscoverSnapshot(
  deps: CatalogDiscoverSnapshotDeps,
  ctx: JobRunContext,
): Promise<void> {
  const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  const media = new MediaService(SYSTEM_USER_ID);
  let snapshots = 0;

  for (const tuple of tuplesForDay(today)) {
    ctx.abortSignal.throwIfAborted();
    const result = await media.discoverFeed({
      ...tuple.filters,
      limit: SNAPSHOT_LIMIT,
    });
    const pairs = collectPairs(result.items as RawCanonicalSource[]);
    if (pairs.length === 0) {
      ctx.logger.debug(`[catalog:discover-snapshot] empty result for ${tuple.kind}/${tuple.sort}`);
      continue;
    }
    await deps.catalog.writeMetadata(pairs.map(({ key, item }) => toCanonicalRow(key, item)));
    await deps.catalog.writeDiscoverSnapshot(
      tuple.kind,
      tuple.sort,
      today,
      pairs.map(({ key }) => key),
    );
    snapshots += 1;
  }

  ctx.logger.info(`[catalog:discover-snapshot] wrote ${snapshots} of 4 daily snapshots`);
}

interface CanonicalPair {
  key: MetadataKey;
  item: RawCanonicalSource;
}

/**
 * Pairs each plugin item with its `(tmdbId, mediaType)` key, dropping any
 * item that has no resolvable key so the ref + canonical lists stay
 * index-aligned by construction.
 */
function collectPairs(items: RawCanonicalSource[]): CanonicalPair[] {
  return items.flatMap((item) => {
    const key = asKey(item);
    return key ? [{ key, item }] : [];
  });
}

// fallow-ignore-next-line complexity
function asKey(item: RawCanonicalSource): MetadataKey | null {
  // Only fall back to splitting the combined `id` string when one of the
  // explicit fields is missing — saves a parse on the typical TMDB payload
  // path where both `ids.tmdb_id` and `type` are populated.
  const split = !item.ids?.tmdb_id || !item.type ? splitCombinedId(item.id) : null;
  const tmdbId = item.ids?.tmdb_id ?? split?.id;
  const type = item.type ?? split?.type;
  if (!tmdbId || (type !== "movie" && type !== "tv")) return null;
  return { tmdbId, type };
}
