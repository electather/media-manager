// fallow-ignore-file code-duplication
// Reason: buildToggleSeed mirrors the per-optional-field seed projection the
// server enrich/adapter/compact paths use; the shapes are independent surfaces
// that happen to converge, not a shared abstraction.
import {
  useMutation,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import * as m from "@/paraglide/messages";
import type { CompactMediaItem, Page } from "@ent-mcp/shared/media";
import {
  keyToId,
  type AddWatchlistRequest,
  type WatchlistKey,
  type WatchlistUserSource,
} from "@ent-mcp/shared/watchlist";
import { mediaKeys } from "./query-keys";
import { addToWatchlist, removeFromWatchlist } from "./media-writes";
import { useWatchlistIdSet, WATCHLIST_ITEMS_SOURCE_ID } from "./use-watchlist-membership";

type MediaPages = InfiniteData<Page, string | undefined>;

/**
 * Params of the default unfiltered all-items cache the optimistic insert targets
 * (sort=recent, no bucket, no mood). Exported so the watchlist shell registers
 * its all-items `ClientMediaSource` with matching params (US-008) and the
 * optimistic row lands in the cache the `/watchlist/all` view reads.
 */
export const DEFAULT_WATCHLIST_ITEMS_PARAMS = { sort: "recent" } as const;

/** The cache key the optimistic add/remove write through. */
const DEFAULT_KEY = mediaKeys.source(WATCHLIST_ITEMS_SOURCE_ID, DEFAULT_WATCHLIST_ITEMS_PARAMS);

/**
 * Sweep the whole media surface after a watchlist mutation in ONE invalidation
 * (#505). Every read — home rows, watchlist sections, counts, moods — nests
 * under `mediaKeys.root`, so a single invalidate replaces the per-feature roots
 * the home and watchlist features each used to flush separately.
 */
function invalidateMediaAll(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: mediaKeys.root });
}

/**
 * Build an optimistic watchlist row from the add request plus whatever partial
 * metadata the caller has on screen. Stamps `addedAt` so `recently_added` sorts
 * the new row first; falls back to a placeholder title when nothing is seeded.
 */
function buildOptimistic(
  request: AddWatchlistRequest,
  seed: Partial<CompactMediaItem>,
): CompactMediaItem {
  return {
    ...seed,
    id: keyToId({ tmdbId: request.tmdbId, mediaType: request.mediaType }),
    tmdbId: request.tmdbId,
    mediaType: request.mediaType,
    title: seed.title ?? `${request.mediaType === "tv" ? "Show" : "Movie"} ${request.tmdbId}`,
    addedAt: Date.now(),
    addedSource: request.source ?? "manual",
  };
}

interface AddVariables {
  request: AddWatchlistRequest;
  seed?: Partial<CompactMediaItem>;
}

interface AddContext {
  snapshot: MediaPages | undefined;
  skippedOptimistic: boolean;
}

/**
 * Shared optimistic add (design §B2). Writes the new row into the default
 * unfiltered all-items cache so cross-feature membership reads flip immediately,
 * then invalidates `mediaKeys.root` once on settle. Filtered (bucket/mood)
 * caches recompute on that sweep rather than being pre-classified client-side.
 */
export function useAddToWatchlist() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, AddVariables, AddContext>({
    mutationFn: ({ request }) => addToWatchlist(request),
    onMutate: async ({ request, seed }) => {
      await qc.cancelQueries({ queryKey: DEFAULT_KEY });
      const snapshot = qc.getQueryData<MediaPages>(DEFAULT_KEY);
      const id = keyToId({ tmdbId: request.tmdbId, mediaType: request.mediaType });
      const alreadyPresent = snapshot?.pages.some((p) => p.items.some((i) => i.id === id)) ?? false;
      if (alreadyPresent || !seed) {
        // No seed → notification deep-link path: skip the insert; the settle
        // invalidation reconciles to the server's authoritative shape.
        return { snapshot, skippedOptimistic: true };
      }
      const optimistic = buildOptimistic(request, seed);
      qc.setQueryData<MediaPages>(DEFAULT_KEY, (data) => {
        // Seed an empty cache so cross-feature toggles show feedback before the
        // user has ever visited the watchlist.
        if (!data || data.pages.length === 0) {
          const firstPage: Page = { items: [optimistic], cursor: null, partial: false };
          return { pages: [firstPage], pageParams: [undefined] };
        }
        const [first, ...rest] = data.pages;
        const updatedFirst: Page = { ...first!, items: [optimistic, ...first!.items] };
        return { ...data, pages: [updatedFirst, ...rest] };
      });
      return { snapshot, skippedOptimistic: false };
    },
    onError: (err, _vars, ctx) => {
      if (ctx && !ctx.skippedOptimistic) qc.setQueryData(DEFAULT_KEY, ctx.snapshot);
      toast.error(m.watchlist_add_error({ message: err.message }));
    },
    onSettled: () => invalidateMediaAll(qc),
  });
}

interface RemoveContext {
  snapshot: MediaPages | undefined;
}

/**
 * Shared optimistic remove (design §B2). Filters the row out of the default
 * all-items cache across every loaded page, then invalidates `mediaKeys.root`
 * once on settle.
 */
export function useRemoveFromWatchlist() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, WatchlistKey, RemoveContext>({
    mutationFn: (key) => removeFromWatchlist(key.tmdbId, key.mediaType),
    onMutate: async (key) => {
      await qc.cancelQueries({ queryKey: DEFAULT_KEY });
      const snapshot = qc.getQueryData<MediaPages>(DEFAULT_KEY);
      const compositeId = keyToId(key);
      qc.setQueryData<MediaPages>(DEFAULT_KEY, (data) => {
        if (!data) return data;
        return {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.filter((i) => i.id !== compositeId),
          })),
        };
      });
      return { snapshot };
    },
    onError: (err, _vars, ctx) => {
      if (ctx) qc.setQueryData(DEFAULT_KEY, ctx.snapshot);
      toast.error(m.watchlist_remove_error({ message: err.message }));
    },
    onSettled: () => invalidateMediaAll(qc),
  });
}

/** Project the on-screen item into the optimistic seed the add mutation hydrates. */
// Each guard drops an absent optional field (CompactMediaItem omits, not nulls); the branch count is inherent.
// fallow-ignore-next-line complexity
function buildToggleSeed(item: CompactMediaItem): Partial<CompactMediaItem> {
  const seed: Partial<CompactMediaItem> = {
    id: item.id,
    tmdbId: item.tmdbId,
    mediaType: item.mediaType,
    title: item.title,
  };
  if (item.year != null) seed.year = item.year;
  if (item.poster) seed.poster = item.poster;
  if (item.backdrop) seed.backdrop = item.backdrop;
  if (item.genres && item.genres.length > 0) seed.genres = item.genres;
  return seed;
}

interface ToggleOptions {
  source?: WatchlistUserSource;
}

/**
 * Returns a referentially stable `toggle(item)` that flips an item's watchlist
 * state (design §B2). Cross-feature surfaces (home cards, search rows) call this
 * without knowing the current state. Stability matters: the callback is forwarded
 * to memoised cards, so the latest id-set and mutation objects are read via refs
 * and only `source` keys the `useCallback`.
 */
export function useToggleWatchlist({ source = "manual" }: ToggleOptions = {}) {
  const ids = useWatchlistIdSet();
  const add = useAddToWatchlist();
  const remove = useRemoveFromWatchlist();
  const idsRef = useRef(ids);
  const addRef = useRef(add);
  const removeRef = useRef(remove);
  useLayoutEffect(() => {
    idsRef.current = ids;
    addRef.current = add;
    removeRef.current = remove;
  });
  return useCallback(
    (item: CompactMediaItem) => {
      if (idsRef.current.has(item.id)) {
        removeRef.current.mutate({ tmdbId: item.tmdbId, mediaType: item.mediaType });
        return;
      }
      addRef.current.mutate({
        request: { tmdbId: item.tmdbId, mediaType: item.mediaType, source },
        seed: buildToggleSeed(item),
      });
    },
    [source],
  );
}
