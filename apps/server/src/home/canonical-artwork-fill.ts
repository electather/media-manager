import type { CompactMediaItem } from "@ent-mcp/shared/home";
import type { CatalogService } from "../catalog";
import type { MetadataKey } from "../catalog/types";

/**
 * Post-fetch artwork backfill. Row fetchers may emit items whose upstream
 * plugin (e.g. Trakt for `recommendations@v1`) does not carry artwork, so
 * `poster` / `backdrop` / `clearLogo` arrive missing on the wire even
 * though `canonical_metadata` already holds TMDB-warmed URLs for the
 * same `(mediaType, tmdbId)`. This helper batches a single
 * `getMetadataBatch` lookup for everything missing artwork and fills
 * each gap from the canonical row when present. No-op for items that
 * already carry every artwork field.
 *
 * Mutates `items` in place to keep the call site at `runFetch` cheap; the
 * caller never re-reads the array element references after `fillMissingArtwork`
 * returns, so the in-place pattern is safe and avoids an alloc per page.
 */
export async function fillMissingArtwork(
  catalogService: Pick<CatalogService, "getMetadataBatch">,
  items: CompactMediaItem[],
): Promise<void> {
  const needed = items.filter((item) => !item.poster || !item.backdrop || !item.clearLogo);
  if (needed.length === 0) return;

  const seen = new Set<string>();
  const keys: MetadataKey[] = [];
  for (const item of needed) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    keys.push({ tmdbId: item.tmdbId, type: item.mediaType });
  }
  const rows = await catalogService.getMetadataBatch(keys);
  for (const item of needed) {
    const row = rows[item.id];
    if (!row) continue;
    if (!item.poster && row.posterUrl) item.poster = row.posterUrl;
    if (!item.backdrop && row.backdropUrl) item.backdrop = row.backdropUrl;
    if (!item.clearLogo && row.clearLogoUrl) item.clearLogo = row.clearLogoUrl;
  }
}
