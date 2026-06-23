import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../../db/client";
import { canonicalMetadata } from "../../db/schema/catalog";
import type { CanonicalMetadata, MetadataKey } from "@nama/shared/catalog";

export async function upsertMetadata(db: Db, rows: CanonicalMetadata[]): Promise<void> {
  if (rows.length === 0) return;
  // INSERT-OR-REPLACE. `created_at` preserved via COALESCE(existing, incoming);
  // `last_refreshed_at` always advances. COALESCE on created_at blocks multi-row upsert
  // (SET references existing column), so one statement per row in single transaction
  // to collapse ~25 WAL commits into one.
  await db.transaction(async (tx) => {
    for (const row of rows) {
      await tx
        .insert(canonicalMetadata)
        .values(row)
        .onConflictDoUpdate({
          target: [canonicalMetadata.tmdbId, canonicalMetadata.mediaType],
          set: {
            title: row.title,
            year: row.year,
            runtimeMinutes: row.runtimeMinutes,
            posterUrl: row.posterUrl,
            backdropUrl: row.backdropUrl,
            // Plain assignment, not COALESCE: TMDB metadata never returns
            // clearLogo, so a 30-day nightly refresh resets the value to
            // null and the next render re-runs `/artwork.get` to refill
            // it. Accepted per design failure-semantics; `patchArtwork`
            // owns the COALESCE-preserving write path.
            clearLogoUrl: row.clearLogoUrl,
            overview: row.overview,
            originalLanguage: row.originalLanguage,
            genres: row.genres,
            features: row.features,
            collectionId: row.collectionId,
            collectionName: row.collectionName,
            lastRefreshedAt: row.lastRefreshedAt,
            lastAccessedAt: row.lastAccessedAt,
            createdAt: sql`COALESCE(${canonicalMetadata.createdAt}, ${row.createdAt})`,
          },
        });
    }
  });
}

/**
 * COALESCE-only artwork patch (V47/V48). Non-null args fill columns only when null; never
 * overwritten. Row absent → 0 rows affected (no throw). Always bumps `last_refreshed_at`.
 */
export async function patchArtworkUrls(
  db: Db,
  key: MetadataKey,
  urls: {
    posterUrl?: string | null;
    backdropUrl?: string | null;
    clearLogoUrl?: string | null;
  },
): Promise<void> {
  const now = Date.now();
  await db
    .update(canonicalMetadata)
    .set({
      posterUrl: sql`COALESCE(${canonicalMetadata.posterUrl}, ${urls.posterUrl ?? null})`,
      backdropUrl: sql`COALESCE(${canonicalMetadata.backdropUrl}, ${urls.backdropUrl ?? null})`,
      clearLogoUrl: sql`COALESCE(${canonicalMetadata.clearLogoUrl}, ${urls.clearLogoUrl ?? null})`,
      lastRefreshedAt: now,
    })
    .where(
      and(eq(canonicalMetadata.tmdbId, key.tmdbId), eq(canonicalMetadata.mediaType, key.type)),
    );
}
