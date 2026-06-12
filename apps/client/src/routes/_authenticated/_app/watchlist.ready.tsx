import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { WATCHLIST_SORTS } from "@nama/shared/watchlist";

import { WatchlistFlatPage } from "@/features/watchlist/components/watchlist-flat-page";
import { WatchlistRouteError } from "@/features/watchlist/components/watchlist-route-error";
import { watchlistItemsSource } from "@/features/watchlist/lib/sources";
import { prefetchMediaRows } from "@/shared/media/use-media-rows";

const searchSchema = z
  .object({
    sort: z.enum(WATCHLIST_SORTS).optional(),
    peek: z.string().optional(),
  })
  .strict();

export const Route = createFileRoute("/_authenticated/_app/watchlist/ready")({
  validateSearch: searchSchema,
  // Only `sort` shapes the first page; `peek` (the modal) must not re-run the loader.
  loaderDeps: ({ search }) => ({ sort: search.sort }),
  loader: ({ context: { queryClient }, deps: { sort } }) =>
    prefetchMediaRows(queryClient, watchlistItemsSource({ sort, bucket: "ready" })),
  errorComponent: WatchlistRouteError,
  component: () => <WatchlistFlatPage bucket="ready" />,
});
