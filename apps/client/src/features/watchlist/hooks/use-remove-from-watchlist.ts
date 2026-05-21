import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { toast } from "sonner";
import * as m from "@/paraglide/messages";
import { keyToId, type WatchlistKey, type WatchlistResponse } from "@ent-mcp/shared/watchlist";
import { removeFromWatchlist } from "@/shared/lib/watchlist/fetchers";
import { watchlistKeys } from "@/shared/lib/watchlist/query-keys";

type WatchlistPages = InfiniteData<WatchlistResponse, string | undefined>;

interface MutationContext {
  snapshot: WatchlistPages | undefined;
}

const DEFAULT_KEY = watchlistKeys.list();

export function useRemoveFromWatchlist() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, WatchlistKey, MutationContext>({
    mutationFn: (key) => removeFromWatchlist(key.tmdbId, key.mediaType),
    onMutate: async (key) => {
      await qc.cancelQueries({ queryKey: DEFAULT_KEY });
      const snapshot = qc.getQueryData<WatchlistPages>(DEFAULT_KEY);
      const compositeId = keyToId(key);
      qc.setQueryData<WatchlistPages>(DEFAULT_KEY, (data) => {
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
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: watchlistKeys.lists() });
      void qc.invalidateQueries({ queryKey: watchlistKeys.counts() });
    },
  });
}
