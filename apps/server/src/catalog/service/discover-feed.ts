import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { discoverSnapshots } from "../../db/schema/catalog";
import type { DiscoverFeedKind, DiscoverSort, MetadataKey } from "@nama/shared/catalog";

/**
 * Shared WHERE clause for (kind, sort, day) indexed lookup on discover_snapshots.
 * Used by both selectDiscoverFeed (full read) and discoverFeedExists (cheap probe)
 * to keep them in lockstep and avoid duplication.
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
 * Cheap eligibility probe — true when a discover_snapshots row exists for (kind, sort, day)
 * without deserializing items array. Lets home discover-snapshot row's eligibility decide
 * visibility without the full-snapshot deserialize cost of fetchRawSet.
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
