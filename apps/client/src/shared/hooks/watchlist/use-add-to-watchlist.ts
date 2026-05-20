import { useMutation, useQueryClient } from "@tanstack/react-query";
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

interface AddVariables {
  request: AddWatchlistRequest;
  seed?: Partial<WatchlistItem>;
}

interface MutationContext {
  snapshot: WatchlistResponse | undefined;
  skippedOptimistic: boolean;
}

export function useAddToWatchlist() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, AddVariables, MutationContext>({
    mutationFn: ({ request }) => addToWatchlist(request),
    onMutate: async ({ request, seed }) => {
      await qc.cancelQueries({ queryKey: watchlistKeys.list() });
      const snapshot = qc.getQueryData<WatchlistResponse>(watchlistKeys.list());
      const id = keyToId({ tmdbId: request.tmdbId, mediaType: request.mediaType });
      const alreadyPresent = snapshot?.items.some((i) => i.id === id) ?? false;
      if (alreadyPresent || !seed) {
        // No seed → notification deep-link path. Skip optimistic insert; the
        // invalidate on settle will reconcile to the server's authoritative
        // shape.
        return { snapshot, skippedOptimistic: true };
      }
      const optimistic = buildOptimistic(request, seed);
      qc.setQueryData<WatchlistResponse>(watchlistKeys.list(), (data) => {
        const previous = data?.items ?? [];
        return {
          items: [optimistic, ...previous],
          partial: data?.partial ?? false,
        };
      });
      return { snapshot, skippedOptimistic: false };
    },
    onError: (err, _vars, ctx) => {
      if (ctx && !ctx.skippedOptimistic) {
        qc.setQueryData(watchlistKeys.list(), ctx.snapshot);
      }
      toast.error(m.watchlist_add_error({ message: err.message }));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: watchlistKeys.list() });
    },
  });
}
