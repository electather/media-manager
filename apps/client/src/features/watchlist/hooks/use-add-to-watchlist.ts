import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { toast } from "sonner";
import * as m from "@/paraglide/messages";
import {
  keyToId,
  type AddWatchlistRequest,
  type WatchlistItem,
  type WatchlistResponse,
} from "@ent-mcp/shared/watchlist";
import { addToWatchlist } from "@/shared/lib/watchlist/fetchers";
import { watchlistKeys } from "@/shared/lib/watchlist/query-keys";
import { buildOptimistic } from "@/shared/lib/watchlist/build-optimistic";
import { invalidateWatchlistAll } from "@/shared/lib/watchlist/invalidate";

interface AddVariables {
  request: AddWatchlistRequest;
  seed?: Partial<WatchlistItem>;
}

type WatchlistPages = InfiniteData<WatchlistResponse, string | undefined>;

interface MutationContext {
  snapshot: WatchlistPages | undefined;
  skippedOptimistic: boolean;
}

const DEFAULT_KEY = watchlistKeys.list();

export function useAddToWatchlist() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, AddVariables, MutationContext>({
    mutationFn: ({ request }) => addToWatchlist(request),
    onMutate: async ({ request, seed }) => {
      // Only cancel + write the *default* (unfiltered) list optimistically.
      // Filtered caches are invalidated on settle — pre-classifying client-
      // side would need the same signals the server uses, and reproducing
      // that here is out of scope for v2.
      await qc.cancelQueries({ queryKey: DEFAULT_KEY });
      const snapshot = qc.getQueryData<WatchlistPages>(DEFAULT_KEY);
      const id = keyToId({ tmdbId: request.tmdbId, mediaType: request.mediaType });
      const alreadyPresent = snapshot?.pages.some((p) => p.items.some((i) => i.id === id)) ?? false;
      if (alreadyPresent || !seed) {
        // No seed → notification deep-link path. Skip optimistic insert; the
        // invalidate on settle will reconcile to the server's authoritative
        // shape.
        return { snapshot, skippedOptimistic: true };
      }
      const optimistic = buildOptimistic(request, seed);
      qc.setQueryData<WatchlistPages>(DEFAULT_KEY, (data) => {
        // Seed an empty cache so cross-feature membership reads (home cards,
        // search rows) flip immediately — without this branch the user has
        // to visit /watchlist once before the toggle shows any UI feedback.
        if (!data || data.pages.length === 0) {
          const firstPage: WatchlistResponse = {
            items: [optimistic],
            cursor: null,
            partial: false,
          };
          return { pages: [firstPage], pageParams: [undefined] };
        }
        const [first, ...rest] = data.pages;
        const updatedFirst: WatchlistResponse = {
          ...first!,
          items: [optimistic, ...first!.items],
        };
        return { ...data, pages: [updatedFirst, ...rest] };
      });
      return { snapshot, skippedOptimistic: false };
    },
    onError: (err, _vars, ctx) => {
      if (ctx && !ctx.skippedOptimistic) {
        qc.setQueryData(DEFAULT_KEY, ctx.snapshot);
      }
      toast.error(m.watchlist_add_error({ message: err.message }));
    },
    onSettled: () => invalidateWatchlistAll(qc),
  });
}
