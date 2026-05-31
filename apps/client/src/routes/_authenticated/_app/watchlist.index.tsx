import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { WatchlistCuratedPage } from "@/features/watchlist/components/watchlist-curated-page";
import { WatchlistRouteError } from "@/features/watchlist/components/watchlist-route-error";
import { watchlistTonightSource } from "@/features/watchlist/lib/sources";
import { prefetchMediaRows } from "@/shared/media/use-media-rows";

const searchSchema = z
  .object({
    peek: z.string().optional(),
  })
  .strict();

export const Route = createFileRoute("/_authenticated/_app/watchlist/")({
  validateSearch: searchSchema,
  // The curated page streams each section under its own Suspense boundary; warm
  // the above-the-fold Tonight hero so it paints on first mount while the rest
  // stream. Blocking only on the hero keeps a slow section from blocking nav.
  loader: ({ context: { queryClient } }) =>
    prefetchMediaRows(queryClient, watchlistTonightSource()),
  errorComponent: WatchlistRouteError,
  component: () => <WatchlistCuratedPage />,
});
