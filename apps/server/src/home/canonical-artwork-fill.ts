import type { CompactMediaItem } from "@ent-mcp/shared/home";
import type { CatalogService } from "../catalog";
import type { CanonicalMetadata, MetadataKey } from "../catalog/types";

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
type ItemSlot = "poster" | "backdrop" | "clearLogo";
type RowSlot = "posterUrl" | "backdropUrl" | "clearLogoUrl";
const ARTWORK_SLOTS: ReadonlyArray<readonly [ItemSlot, RowSlot]> = [
  ["poster", "posterUrl"],
  ["backdrop", "backdropUrl"],
  ["clearLogo", "clearLogoUrl"],
];

export async function fillMissingArtwork(
  catalogService: Pick<CatalogService, "getMetadataBatch">,
  items: CompactMediaItem[],
): Promise<void> {
  const needed = items.filter(isArtworkIncomplete);
  if (needed.length === 0) return;
  const rows = await catalogService.getMetadataBatch(uniqueLookupKeys(needed));
  for (const item of needed) applyCanonicalArtwork(item, rows[item.id]);
}

function isArtworkIncomplete(item: CompactMediaItem): boolean {
  return ARTWORK_SLOTS.some(([slot]) => !item[slot]);
}

function uniqueLookupKeys(items: CompactMediaItem[]): MetadataKey[] {
  const seen = new Set<string>();
  const keys: MetadataKey[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    keys.push({ tmdbId: item.tmdbId, type: item.mediaType });
  }
  return keys;
}

function applyCanonicalArtwork(item: CompactMediaItem, row: CanonicalMetadata | undefined): void {
  if (!row) return;
  for (const [slot, source] of ARTWORK_SLOTS) fillSlot(item, slot, row[source]);
}

function fillSlot(item: CompactMediaItem, slot: ItemSlot, url: string | null | undefined): void {
  if (!item[slot] && url) item[slot] = url;
}
