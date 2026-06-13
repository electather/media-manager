import { and, asc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { groupBy } from "es-toolkit/array";
import type { Db } from "../../db/client";
import { canonicalMetadata, idMap } from "../../db/schema/catalog";
import type {
  CanonicalMetadata,
  CanonicalMetadataWithIds,
  IdMap,
  MetadataKey,
} from "@nama/shared/catalog";
import { candidateId } from "../features";

export async function selectMetadata(
  db: Db,
  tmdbId: string,
  type: "movie" | "tv",
): Promise<CanonicalMetadata | null> {
  const row = await db
    .select()
    .from(canonicalMetadata)
    .where(and(eq(canonicalMetadata.tmdbId, tmdbId), eq(canonicalMetadata.mediaType, type)))
    .get();
  return row ?? null;
}

export async function selectMetadataBatch(
  db: Db,
  items: MetadataKey[],
): Promise<{ out: Record<string, CanonicalMetadata>; accessed: MetadataKey[] }> {
  // SQLite has no row-tuple `IN ((a,b), …)` form, so we batch per
  // `mediaType` and union the results. Two queries max in practice;
  // the composite PK serves both lookups via index.
  const buckets = groupBy(items, (item) => item.type);
  const out: Record<string, CanonicalMetadata> = {};
  const accessed: MetadataKey[] = [];
  for (const [type, typeItems] of Object.entries(buckets) as Array<
    ["movie" | "tv", MetadataKey[]]
  >) {
    const rows = await db
      .select()
      .from(canonicalMetadata)
      .where(
        and(
          eq(canonicalMetadata.mediaType, type),
          inArray(
            canonicalMetadata.tmdbId,
            typeItems.map((i) => i.tmdbId),
          ),
        ),
      );
    for (const row of rows) {
      out[candidateId({ tmdbId: row.tmdbId, type: row.mediaType })] = row;
      accessed.push({ tmdbId: row.tmdbId, type: row.mediaType });
    }
  }
  return { out, accessed };
}

export async function selectMetadataWithIds(
  db: Db,
  tmdbId: string,
  type: "movie" | "tv",
): Promise<CanonicalMetadataWithIds | null> {
  const row = await db
    .select({
      canonical: canonicalMetadata,
      ids: idMap,
    })
    .from(canonicalMetadata)
    .leftJoin(
      idMap,
      and(
        eq(idMap.tmdbId, canonicalMetadata.tmdbId),
        eq(idMap.mediaType, canonicalMetadata.mediaType),
      ),
    )
    .where(and(eq(canonicalMetadata.tmdbId, tmdbId), eq(canonicalMetadata.mediaType, type)))
    .get();
  if (!row) return null;
  return { ...row.canonical, ids: toIdMap(row.ids) };
}

export async function selectStaleMetadataKeys(
  db: Db,
  staleAfterMs: number,
  limit: number,
): Promise<MetadataKey[]> {
  const cutoff = Date.now() - staleAfterMs;
  const rows = await db
    .select({ tmdbId: canonicalMetadata.tmdbId, mediaType: canonicalMetadata.mediaType })
    .from(canonicalMetadata)
    .where(
      or(
        lt(canonicalMetadata.lastRefreshedAt, cutoff),
        // `features` is NULL when a row was warm-written by the discover
        // snapshot side-effect but never enriched; treat that as stale
        // so the next refresh picks it up.
        sql`${canonicalMetadata.features} IS NULL`,
      ),
    )
    .orderBy(
      // NULL-feature rows come from a side-effect warm and have a fresh
      // `last_refreshed_at`; they would otherwise sort last and miss
      // refresh cycles when 500+ time-stale rows are queued ahead.
      asc(sql`CASE WHEN ${canonicalMetadata.features} IS NULL THEN 0 ELSE 1 END`),
      asc(canonicalMetadata.lastRefreshedAt),
    )
    .limit(limit);
  return rows.map((r) => ({ tmdbId: r.tmdbId, type: r.mediaType }));
}

// fallow-ignore-next-line complexity
function toIdMap(row: typeof idMap.$inferSelect | null): IdMap | null {
  if (!row) return null;
  return {
    tmdbId: row.tmdbId,
    mediaType: row.mediaType,
    imdbId: row.imdbId ?? null,
    tvdbId: row.tvdbId ?? null,
    traktId: row.traktId ?? null,
    traktSlug: row.traktSlug ?? null,
  };
}
