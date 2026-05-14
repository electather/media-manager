import type { MediaType } from "@ent-mcp/shared/media";
import type { CanonicalMetadata } from "../../catalog/types";
import { extractTmdbId, fromCanonicalMetadata } from "../adapters";
import type { InternalCompactMediaItem, RowContext } from "../types";

export interface MediaKey {
  tmdbId: string;
  type: MediaType;
}

/**
 * Probes a raw `metadata@v1.getSimilar` result entry for `{ tmdbId, type }`.
 * Shared by every row that paginates a similar-feed (becauseYouWatched,
 * similarTo) so the entry-shape rules live in one place.
 */
export function toSimilarHit(value: unknown): MediaKey | null {
  const tmdbId = extractTmdbId(value);
  if (!tmdbId) return null;
  const t = (value as { type?: string }).type;
  const type: MediaType = t === "tv" || t === "show" ? "tv" : "movie";
  return { tmdbId, type };
}

/**
 * Shared page fetch for similar-feed rows. Wraps the `getSimilarFeed` call,
 * candidate extraction, catalog enrichment, pagination, and seedTitle hookup
 * — every consumer differs only in cursor schema. Returns the typed page
 * plus a `hasMore` flag so the caller can encode its own next cursor.
 */
export async function fetchSimilarPage(
  ctx: RowContext,
  seed: { id: string; type: MediaType; offset: number; pageSize: number },
): Promise<{ items: InternalCompactMediaItem[]; hasMore: boolean; partial: boolean }> {
  const res = await ctx.mediaService.getSimilarFeed({
    id: seed.id,
    type: seed.type,
    ...(ctx.deadlineMs !== undefined ? { deadlineMs: ctx.deadlineMs } : {}),
  });
  const seedMeta = await ctx.catalog.getMetadata(seed.id, seed.type);
  if (seedMeta) ctx.seedTitle = seedMeta.title;
  const candidates = (res.items as unknown[])
    .map(toSimilarHit)
    .filter((c): c is MediaKey => c !== null);
  const slice = candidates.slice(seed.offset, seed.offset + seed.pageSize);
  const items = await loadCanonicalItems(ctx, slice);
  return {
    items,
    hasMore: candidates.length > seed.offset + seed.pageSize,
    partial: res.partial,
  };
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
