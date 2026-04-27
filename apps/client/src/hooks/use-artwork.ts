import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ArtworkBundle, ArtworkRequestItem } from "@ent-mcp/shared/artwork";
import { api } from "@/lib/api";

/**
 * Empty bundle returned while a real fetch is in flight, on error, or for
 * items the server could not resolve. Stable reference so consumers can
 * treat fallbacks deterministically without `?? EMPTY` guards everywhere.
 */
export const EMPTY_BUNDLE: ArtworkBundle = Object.freeze({
  poster: [],
  backdrop: [],
  clearLogo: [],
  thumb: [],
}) as ArtworkBundle;

const FLUSH_DEBOUNCE_MS = 50;
// Wire-level cap from `artworkGetInputSchema`. Keep the client cap lower than
// or equal to the server cap so a debounce that captures more than 50 items
// at once splits cleanly into multiple POSTs instead of getting rejected
// upstream.
const MAX_BATCH_SIZE = 50;

interface Pending {
  item: ArtworkRequestItem;
  resolvers: Array<(bundle: ArtworkBundle) => void>;
  rejecters: Array<(err: Error) => void>;
}

const PENDING = new Map<string, Pending>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Module-scope batch queue. Mounted cards push their request into the queue
 * and the debounced `flush` collapses everything into ≤50-item POSTs to
 * `/api/artwork/get`. Resolution fan-out is handled per-key so two cards
 * referencing the same canonical item still get their own promise.
 */
function enqueue(item: ArtworkRequestItem): Promise<ArtworkBundle> {
  return new Promise<ArtworkBundle>((resolve, reject) => {
    let entry = PENDING.get(item.key);
    if (!entry) {
      entry = { item, resolvers: [], rejecters: [] };
      PENDING.set(item.key, entry);
    }
    entry.resolvers.push(resolve);
    entry.rejecters.push(reject);
    if (!flushTimer) flushTimer = setTimeout(() => void flush(), FLUSH_DEBOUNCE_MS);
  });
}

async function flush(): Promise<void> {
  flushTimer = null;
  const pending = [...PENDING.values()];
  PENDING.clear();
  for (let i = 0; i < pending.length; i += MAX_BATCH_SIZE) {
    const slice = pending.slice(i, i + MAX_BATCH_SIZE);
    await dispatchSlice(slice);
  }
}

async function dispatchSlice(slice: Pending[]): Promise<void> {
  try {
    const res = await api.artwork.get.$post({
      json: { items: slice.map((p) => p.item) },
    });
    if (!res.ok) throw new Error(`artwork.get failed: HTTP ${res.status}`);
    const data = (await res.json()) as { results: Record<string, ArtworkBundle> };
    for (const pending of slice) {
      const bundle = data.results[pending.item.key] ?? EMPTY_BUNDLE;
      pending.resolvers.forEach((resolve) => resolve(bundle));
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    for (const pending of slice) {
      pending.rejecters.forEach((reject) => reject(error));
    }
  }
}

export const artworkQueryKey = (key: string) => ["artwork", key] as const;

/**
 * Fetches artwork for a single media item, batched against every other
 * `useArtwork` call within the same debounce window. Resolves to the
 * `EMPTY_BUNDLE` on failure so consumers always get a stable shape — they
 * can prefer inline `CompactMediaItem.poster`/`backdrop`/`clearLogo`
 * fallbacks while the bundle is empty.
 */
export function useArtwork(item: ArtworkRequestItem): UseQueryResult<ArtworkBundle> {
  return useQuery({
    queryKey: artworkQueryKey(item.key),
    queryFn: () => enqueue(item),
    // Artwork is shared across users (capability scope = global) and rarely
    // changes, so a long client-side stale window keeps fan-out small as the
    // user scrolls back through rows already rendered once.
    staleTime: 60 * 60 * 1000,
    gcTime: 4 * 60 * 60 * 1000,
    retry: 1,
  });
}
