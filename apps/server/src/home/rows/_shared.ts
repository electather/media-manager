import type { MediaType } from "@ent-mcp/shared/media";
import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";
import type { RowKind } from "@ent-mcp/shared/home";
import type { MediaSource } from "../../media";
import { extractTmdbId, fromCanonicalMetadata } from "../internal/adapters";
import type { InternalCompactMediaItem, RowContext, RowProvider } from "../internal/types";
import { similarSource } from "../sources/similar";

export interface MediaKey {
  tmdbId: string;
  type: MediaType;
}

interface SimilarFeedEntry {
  expiresAt: number;
  candidates: MediaKey[];
  partial: boolean;
  seedTitle: string | undefined;
}

// Cache resolved candidate lists per seed so paginating row consumers don't
// re-fetch the full `metadata@v1.getSimilar` feed (and the seed catalog
// metadata) on every page request. The plugin call is the expensive bit;
// candidate decoding + seed-meta lookup are deterministic over the same seed,
// so caching for a short window keeps wall-clock latency low without staling
// out across user sessions. Per-user keyed for safety even though
// `metadata@v1.getSimilar` is itself user-agnostic — keeps cache invalidation
// trivially user-scoped if we ever start mixing identity into the response.
const SIMILAR_FEED_TTL_MS = 60_000;
const SIMILAR_FEED_CACHE_MAX = 256;
const similarFeedCache = new Map<string, SimilarFeedEntry>();

function similarCacheKey(userId: string, seedId: string, seedType: MediaType): string {
  return `${userId}:${seedType}:${seedId}`;
}

function readSimilarCache(key: string): SimilarFeedEntry | undefined {
  const entry = similarFeedCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    similarFeedCache.delete(key);
    return undefined;
  }
  // Touch the entry's insertion order so the FIFO eviction below acts roughly
  // like LRU for hot seeds.
  similarFeedCache.delete(key);
  similarFeedCache.set(key, entry);
  return entry;
}

function writeSimilarCache(key: string, entry: SimilarFeedEntry): void {
  similarFeedCache.set(key, entry);
  while (similarFeedCache.size > SIMILAR_FEED_CACHE_MAX) {
    const oldest = similarFeedCache.keys().next().value;
    if (oldest === undefined) break;
    similarFeedCache.delete(oldest);
  }
}

/**
 * Shared page fetch for similar-feed rows. Wraps the `getSimilarFeed` call,
 * candidate extraction, catalog enrichment, pagination, and seedTitle hookup
 * — every consumer differs only in cursor schema. Returns the typed page
 * plus a `hasMore` flag so the caller can encode its own next cursor.
 *
 * Mutates `ctx.seedTitle` so the orchestrator's match-reason resolver
 * (`similar_to_seed`) can surface the seed title without a second lookup.
 *
 * The resolved candidate list is cached per `(userId, seedType, seedId)` for
 * `SIMILAR_FEED_TTL_MS` so subsequent page requests against the same seed
 * skip the round-trip into the metadata plugin and the catalog.
 */
// fallow-ignore-next-line complexity
export async function fetchSimilarPage(
  ctx: RowContext,
  seed: { id: string; type: MediaType; offset: number; pageSize: number },
): Promise<{ items: InternalCompactMediaItem[]; hasMore: boolean; partial: boolean }> {
  const cacheKey = similarCacheKey(ctx.userId, seed.id, seed.type);
  let entry = readSimilarCache(cacheKey);
  if (!entry) {
    // The similar `MediaSource` owns the raw candidate fetch (getSimilarFeed +
    // entry-shape probe); the cache, slice, and seedTitle hookup stay here
    // until US-022/US-023 fold them into the shared pipeline.
    const { rows, partial } = await similarSource.fetchRawSet(
      ctx,
      { seedId: seed.id, seedType: seed.type },
      null,
    );
    const seedMeta = await ctx.catalog.getMetadata(seed.id, seed.type);
    entry = {
      expiresAt: Date.now() + SIMILAR_FEED_TTL_MS,
      candidates: rows,
      partial,
      seedTitle: seedMeta?.title,
    };
    writeSimilarCache(cacheKey, entry);
  }
  if (entry.seedTitle) ctx.seedTitle = entry.seedTitle;
  const slice = entry.candidates.slice(seed.offset, seed.offset + seed.pageSize);
  const items = await loadCanonicalItems(ctx, slice);
  return {
    items,
    hasMore: entry.candidates.length > seed.offset + seed.pageSize,
    partial: entry.partial,
  };
}

// fallow-ignore-next-line unused-export
export function __clearSimilarFeedCacheForTests(): void {
  similarFeedCache.clear();
}

/**
 * Builds a bounded (cursor-less) capability-gated row from a `MediaSource`.
 * The `continueWatching-next` and `upcomingForYou` rows ship one page and never
 * paginate, so they share the same provider shape — `eligibility` flips on a
 * capability provider, `initialCursor` is null, and `fetchPage` pulls the
 * source's raw set then projects it (cursor always null, `partial` rides
 * through). Only the capability, source, and per-row projection differ, so they
 * pass them as config (mirrors `makeDiscoverSnapshotRow` / `makeRecommendedForYou`).
 */
export function makeBoundedRow<Row>(config: {
  rowId: string;
  kind: RowKind;
  titleKey: string;
  eyebrowKey?: string;
  capability: string;
  source: MediaSource<void, Row>;
  project: (
    ctx: RowContext,
    rows: Row[],
  ) => InternalCompactMediaItem[] | Promise<InternalCompactMediaItem[]>;
}): RowProvider {
  return {
    rowId: config.rowId,
    kind: config.kind,
    titleKey: config.titleKey,
    ...(config.eyebrowKey ? { eyebrowKey: config.eyebrowKey } : {}),
    async eligibility(ctx) {
      return ctx.mediaService.hasCapabilityProvider(config.capability, "v1", "user");
    },
    async initialCursor() {
      return null;
    },
    async fetchPage(ctx) {
      const { rows, partial } = await config.source.fetchRawSet(ctx, undefined, null);
      return { items: await config.project(ctx, rows), cursor: null, partial };
    },
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
