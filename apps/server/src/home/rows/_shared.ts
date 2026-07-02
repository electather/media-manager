import type { MediaType } from "@nama/shared/media";
import type { CanonicalMetadata } from "@nama/shared/catalog";
import { HttpError } from "../../diagnostics/http-errors";
import { TokenBucketLimiter } from "../../diagnostics/rate-limit";
import { extractTmdbId, type SourceContext } from "../../media";
import { fromCanonicalMetadata } from "../internal/adapters";
import type { InternalCompactMediaItem, RowContext } from "../internal/types";
import { similarSource } from "../sources/similar";

export interface MediaKey {
  tmdbId: string;
  type: MediaType;
}

/** Shared page size for every home row (the pipeline `limit`). */
export const ROW_PAGE_SIZE = 12;

interface SimilarFeedEntry {
  expiresAt: number;
  candidates: MediaKey[];
  partial: boolean;
  seedTitle: string | undefined;
}

// Caches candidates per seed for pagination without re-invoking `metadata@v1.getSimilar` (the expensive bit).
// Per-user keyed for safety; lets cache invalidation stay user-scoped if identity is mixed in later.
const SIMILAR_FEED_TTL_MS = 60_000;
const SIMILAR_FEED_CACHE_MAX = 256;
const similarFeedCache = new Map<string, SimilarFeedEntry>();

// Per-user throttle on cache-MISS similar fetches only (#923). `seedId` is client-controlled and
// cache-bustable: cycling arbitrary ids skips `similarFeedCache` and drives unbounded external
// `metadata@v1.getSimilar` calls. Pagination re-reads a cached seed and never debits, so this
// bounds distinct-seed fetches without limiting legitimate paging. 30 burst, refill 0.5/s (~30/min).
const similarSeedLimiter = new TokenBucketLimiter({ capacity: 30, refillPerSec: 0.5 });

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
 * Resolves + caches candidates and seed title per `(userId, seedType, seedId)` for `SIMILAR_FEED_TTL_MS`.
 * Wraps the similar `MediaSource` fetch and catalog title lookup; `similarPagedSource` windows candidates
 * and the row pipeline projects + enriches them.
 */
export async function resolveSimilarCandidates(
  ctx: SourceContext,
  seedId: string,
  seedType: MediaType,
): Promise<{ candidates: MediaKey[]; partial: boolean; seedTitle: string | undefined }> {
  const cacheKey = similarCacheKey(ctx.userId, seedId, seedType);
  let entry = readSimilarCache(cacheKey);
  if (!entry) {
    // Debit before the external fetch, not before the cache read: throttling reads would break
    // legitimate deep pagination that only ever hits the cache.
    const limited = similarSeedLimiter.check(ctx.userId);
    if (limited) {
      // 429 lands in the expected-user-error band (not captured as a 5xx bug).
      throw new HttpError(
        429,
        "home.similar_seed_rate_limited",
        `similar-title rate limit exceeded; retry after ${limited.retryAfterSec}s`,
        { retry_after: limited.retryAfterSec },
      );
    }
    const { rows, partial } = await similarSource.fetchRawSet(ctx, { seedId, seedType }, null);
    const seedMeta = await ctx.catalog.getMetadata(seedId, seedType);
    entry = {
      expiresAt: Date.now() + SIMILAR_FEED_TTL_MS,
      candidates: rows,
      partial,
      seedTitle: seedMeta?.title,
    };
    writeSimilarCache(cacheKey, entry);
  }
  return { candidates: entry.candidates, partial: entry.partial, seedTitle: entry.seedTitle };
}

// fallow-ignore-next-line unused-export
export function __clearSimilarFeedCacheForTests(): void {
  similarFeedCache.clear();
  similarSeedLimiter.reset();
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
 * Shared pipeline: fetch keys, batch-lookup canonical metadata, map to compact items.
 * Composite key `${type}:${tmdbId}` is locked in by `getMetadataBatch`, so do not re-derive.
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
 * Probe for `watchlist@v1` / `calendar@v1` payloads. Wraps as `{ item: {...}, ...extra }` (Trakt) or `item` directly (other plugins).
 * Returns raw outer + inner records so callers can read provider-specific fields without re-walking.
 */
// fallow-ignore-next-line complexity code-duplication
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
