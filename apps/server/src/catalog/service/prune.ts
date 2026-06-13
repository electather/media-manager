import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { groupBy } from "es-toolkit/array";
import type { Db } from "../../db/client";
import { canonicalMetadata, discoverSnapshots, recommendationLists } from "../../db/schema/catalog";
import { candidateId } from "../features";

export async function pruneUnusedMetadataRows(
  db: Db,
  unusedAfterMs: number,
  refSet: Set<string> | undefined,
  snapshotRetentionDays: number,
): Promise<{ deleted: number }> {
  const cutoff = Date.now() - unusedAfterMs;
  const refs = refSet ?? (await buildPruneRefSet(db, snapshotRetentionDays));
  const candidates = await db
    .select({ tmdbId: canonicalMetadata.tmdbId, mediaType: canonicalMetadata.mediaType })
    .from(canonicalMetadata)
    .where(lt(canonicalMetadata.lastAccessedAt, cutoff));
  // Bucket non-referenced ids by media type so each type drops in a
  // single statement. Per-row DELETEs would hold the SQLite WAL for
  // the entire sweep; bucketed DELETEs collapse to one commit per type.
  const toDelete = groupBy(
    candidates.filter((r) => !refs.has(candidateId({ tmdbId: r.tmdbId, type: r.mediaType }))),
    (r) => r.mediaType,
  );
  let deleted = 0;
  for (const [type, rows] of Object.entries(toDelete) as Array<
    ["movie" | "tv", typeof candidates]
  >) {
    await db.delete(canonicalMetadata).where(
      and(
        eq(canonicalMetadata.mediaType, type),
        inArray(
          canonicalMetadata.tmdbId,
          rows.map((r) => r.tmdbId),
        ),
      ),
    );
    deleted += rows.length;
  }
  return { deleted };
}

/**
 * Builds the in-memory reference set used by `pruneUnusedMetadataRows`. Pulls
 * every id from `recommendation_lists.items` plus discover snapshots
 * within the configured retention window so a row can be cold-by-access
 * yet still pinned by an active rec list or recent snapshot.
 */
// fallow-ignore-next-line complexity
async function buildPruneRefSet(db: Db, snapshotRetentionDays: number): Promise<Set<string>> {
  const refs = new Set<string>();
  const lists = await db.select({ items: recommendationLists.items }).from(recommendationLists);
  for (const row of lists) {
    for (const item of row.items) {
      refs.add(candidateId({ tmdbId: item.tmdbId, type: item.mediaType }));
    }
  }
  const cutoff = Date.now() - snapshotRetentionDays * 24 * 60 * 60 * 1000;
  const snapshots = await db
    .select({ items: discoverSnapshots.items })
    .from(discoverSnapshots)
    .where(gte(discoverSnapshots.day, cutoff));
  for (const snapshot of snapshots) {
    for (const ref of snapshot.items) {
      refs.add(candidateId(ref));
    }
  }
  return refs;
}

export async function deleteOldDiscoverSnapshots(
  db: Db,
  olderThanDays: number,
): Promise<{ deleted: number }> {
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const deleted = await db
    .delete(discoverSnapshots)
    .where(lt(discoverSnapshots.day, cutoff))
    .returning({ day: discoverSnapshots.day });
  return { deleted: deleted.length };
}
