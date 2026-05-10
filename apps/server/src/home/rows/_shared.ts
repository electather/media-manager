import type { MediaType } from "@ent-mcp/shared/media";
import type { CanonicalMetadata } from "../../catalog/types";
import { extractTmdbId, fromCanonicalMetadata } from "../adapters";
import type { InternalCompactMediaItem, RowContext } from "../types";

export interface MediaKey {
  tmdbId: string;
  type: MediaType;
}

interface LoadCanonicalOptions<T> {
  /** Per-input options forwarded to `fromCanonicalMetadata` (e.g. `topContributors`). */
  fromOptions?: (input: T) => Parameters<typeof fromCanonicalMetadata>[1];
  /** Hook to mutate the produced item (e.g. attach episode payload on upcoming). */
  decorate?: (item: InternalCompactMediaItem, input: T) => void;
  /** Returns a stub item when the catalog has no row yet — your-watchlist relies on this. */
  onMissing?: (input: T) => InternalCompactMediaItem | null;
}

/**
 * Shared metadata-batch + iterate pipeline. Most home rows fetch a windowed
 * slice of `{ tmdbId, type }` keys, look up canonical metadata in one call,
 * then map to compact items. The composite-key shape (`${type}:${tmdbId}`)
 * is locked in by `getMetadataBatch`, so callers should not re-derive it.
 */
// fallow-ignore-next-line complexity
export async function loadCanonicalItems<T extends MediaKey>(
  ctx: Pick<RowContext, "catalog">,
  inputs: T[],
  options: LoadCanonicalOptions<T> = {},
): Promise<InternalCompactMediaItem[]> {
  if (inputs.length === 0) return [];
  const metadata = await ctx.catalog.getMetadataBatch(
    inputs.map((k) => ({ tmdbId: k.tmdbId, type: k.type })),
  );
  const items: InternalCompactMediaItem[] = [];
  for (const input of inputs) {
    const meta = metadata[`${input.type}:${input.tmdbId}`] as CanonicalMetadata | undefined;
    if (meta) {
      const item = fromCanonicalMetadata(meta, options.fromOptions?.(input));
      options.decorate?.(item, input);
      items.push(item);
      continue;
    }
    const fallback = options.onMissing?.(input);
    if (fallback) items.push(fallback);
  }
  return items;
}

/**
 * Common entry-shape probe for `watchlist@v1` / `calendar@v1` plugin payloads.
 * Both wrap entries as `{ item: {...}, ...extra }` (Trakt) or pass `item`
 * directly (other plugins), with the tmdb id under `ids.tmdb` and the type on
 * `item.type`. Returns the raw outer + inner records so callers can read
 * provider-specific fields (airsAt, fallback title) without re-walking.
 */
// fallow-ignore-next-line complexity
export function probeMediaEntry(
  value: unknown,
): { key: MediaKey; itemRaw: Record<string, unknown>; outer: Record<string, unknown> } | null {
  if (!value || typeof value !== "object") return null;
  const outer = value as Record<string, unknown>;
  const itemRaw = (outer.item ?? outer) as Record<string, unknown>;
  const tmdbId = extractTmdbId(itemRaw);
  if (!tmdbId) return null;
  const type: MediaType = itemRaw.type === "movie" ? "movie" : "tv";
  return { key: { tmdbId, type }, itemRaw, outer };
}
