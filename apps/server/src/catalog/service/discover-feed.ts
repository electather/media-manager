import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { discoverSnapshots } from "../../db/schema/catalog";
import type { DiscoverFeedKind, DiscoverSort, MetadataKey } from "@nama/shared/catalog";

/**
 * Shared WHERE clause for the `(kind, sort, day)` indexed lookup on
 * `discover_snapshots`. Used by both `selectDiscoverFeed` (full read) and
 * `discoverFeedExists` (cheap existence probe) so the two stay in lockstep
 * and the where-clause isn't duplicated across the functions.
 */
function discoverSnapshotWhere(kind: DiscoverFeedKind, sort: DiscoverSort, day: number) {
  return and(
    eq(discoverSnapshots.feedKind, kind),
    eq(discoverSnapshots.sort, sort),
    eq(discoverSnapshots.day, day),
  );
}

export async function selectDiscoverFeed(
  db: Db,
  kind: DiscoverFeedKind,
  sort: DiscoverSort,
  day: number,
): Promise<MetadataKey[] | null> {
  const row = await db
    .select({ items: discoverSnapshots.items })
    .from(discoverSnapshots)
    .where(discoverSnapshotWhere(kind, sort, day))
    .get();
  return row?.items ?? null;
}

/**
 * Cheap eligibility probe — `true` when a `discover_snapshots` row exists
 * for `(kind, sort, day)` without deserializing the snapshot's items array.
 * Lets the home discover-snapshot row's `eligibility` decide visibility
 * without paying the same full-snapshot read `load` will pay through
 * `fetchRawSet`.
 */
export async function discoverFeedExists(
  db: Db,
  kind: DiscoverFeedKind,
  sort: DiscoverSort,
  day: number,
): Promise<boolean> {
  const row = await db
    .select({ one: sql<number>`1` })
    .from(discoverSnapshots)
    .where(discoverSnapshotWhere(kind, sort, day))
    .get();
  return row != null;
}

export async function upsertDiscoverSnapshot(
  db: Db,
  kind: DiscoverFeedKind,
  sort: DiscoverSort,
  day: number,
  items: MetadataKey[],
): Promise<void> {
  const generatedAt = Date.now();
  await db
    .insert(discoverSnapshots)
    .values({ feedKind: kind, sort, day, items, generatedAt })
    .onConflictDoUpdate({
      target: [discoverSnapshots.feedKind, discoverSnapshots.sort, discoverSnapshots.day],
      set: { items, generatedAt },
    });
}
