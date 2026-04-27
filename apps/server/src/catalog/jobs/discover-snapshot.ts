import { MediaService } from "../../media/service";
import { registerScheduled } from "../../jobs/scheduled";
import type { JobRunContext } from "../../jobs/types";
import type { CatalogService } from "../../catalog";
import { toCanonicalRow, type RawCanonicalSource } from "../canonical";
import type { CanonicalMetadata, DiscoverFeedKind, DiscoverSort, MetadataKey } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_LIMIT = 60;
const SYSTEM_USER_ID = "__system__";

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
  sort: DiscoverSort | "popularity_asc" | "release_date_desc";
}

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
      kind: "trending",
      sort: "popularity_desc",
      filters: { sort: "popularity_desc" },
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
    const items = result.items as RawCanonicalSource[];
    const refs = collectRefs(items);
    if (refs.length === 0) {
      ctx.logger.debug(`[catalog:discover-snapshot] empty result for ${tuple.kind}/${tuple.sort}`);
      continue;
    }
    const canonical = collectCanonical(refs, items);
    if (canonical.length > 0) await deps.catalog.writeMetadata(canonical);
    await deps.catalog.writeDiscoverSnapshot(tuple.kind, tuple.sort, today, refs);
    snapshots += 1;
  }

  ctx.logger.info(`[catalog:discover-snapshot] wrote ${snapshots} of 4 daily snapshots`);
}

/**
 * Pairs each plugin item with the matching canonical row, dropping any item
 * that has no resolvable `(tmdbId, mediaType)` so the snapshot stays ref-
 * able by the downstream metadata batcher.
 */
function collectRefs(items: RawCanonicalSource[]): MetadataKey[] {
  const refs: MetadataKey[] = [];
  for (const item of items) {
    const key = asKey(item);
    if (key) refs.push(key);
  }
  return refs;
}

function collectCanonical(refs: MetadataKey[], items: RawCanonicalSource[]): CanonicalMetadata[] {
  const out: CanonicalMetadata[] = [];
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    const item = items[i];
    if (!ref || !item) continue;
    out.push(toCanonicalRow(ref, item));
  }
  return out;
}

function asKey(item: RawCanonicalSource): MetadataKey | null {
  const tmdbId = item.ids?.tmdb_id ?? splitFromCombined(item.id)?.id;
  const type = item.type ?? splitFromCombined(item.id)?.type;
  if (!tmdbId || (type !== "movie" && type !== "tv")) return null;
  return { tmdbId, type };
}

function splitFromCombined(
  combined: string | undefined,
): { type: "movie" | "tv"; id: string } | null {
  if (!combined) return null;
  const [type, id] = combined.split(":");
  if ((type !== "movie" && type !== "tv") || !id) return null;
  return { type, id };
}
