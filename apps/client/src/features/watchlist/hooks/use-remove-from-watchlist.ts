import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import * as m from "@/paraglide/messages";
import { keyToId, type WatchlistKey, type WatchlistResponse } from "@ent-mcp/shared/watchlist";
import { removeFromWatchlist } from "../lib/fetchers";
import { watchlistKeys } from "../lib/query-keys";

interface MutationContext {
  snapshot: WatchlistResponse | undefined;
}

export function useRemoveFromWatchlist() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, WatchlistKey, MutationContext>({
    mutationFn: (key) => removeFromWatchlist(key.tmdbId, key.mediaType),
    onMutate: async (key) => {
      await qc.cancelQueries({ queryKey: watchlistKeys.list() });
      const snapshot = qc.getQueryData<WatchlistResponse>(watchlistKeys.list());
      const compositeId = keyToId(key);
      qc.setQueryData<WatchlistResponse>(watchlistKeys.list(), (data) => {
        if (!data) return data;
        return {
          items: data.items.filter((i) => i.id !== compositeId),
          partial: data.partial,
        };
      });
      return { snapshot };
    },
    onError: (err, _vars, ctx) => {
      if (ctx) qc.setQueryData(watchlistKeys.list(), ctx.snapshot);
      toast.error(m.watchlist_remove_error({ message: err.message }));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: watchlistKeys.list() });
    },
  });
}
