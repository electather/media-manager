import { createFileRoute, notFound } from "@tanstack/react-router";
import { z } from "zod";
import { MOOD_IDS, type MoodId } from "@ent-mcp/shared/watchlist";

import {
  MOOD_PAGE_LIMIT,
  WatchlistMoodPage,
} from "@/features/watchlist/components/watchlist-mood-page";
import { WatchlistRouteError } from "@/features/watchlist/components/watchlist-route-error";
import { watchlistMoodItemsSource } from "@/features/watchlist/lib/sources";
import { prefetchMediaRows } from "@/shared/media/use-media-rows";

const MOOD_ID_SET: ReadonlySet<string> = new Set(MOOD_IDS);

const searchSchema = z
  .object({
    peek: z.string().optional(),
  })
  .strict();

export const Route = createFileRoute("/_authenticated/_app/watchlist/moods/$moodId")({
  validateSearch: searchSchema,
  // #515: an unknown mood id is a missing resource, so render the 404 page
  // (throw notFound()) rather than a param-parse error → section error
  // boundary. The component can treat the param as a valid MoodId thereafter.
  beforeLoad: ({ params }) => {
    if (!MOOD_ID_SET.has(params.moodId)) throw notFound();
  },
  // `beforeLoad` has admitted only valid mood ids, so the cast is safe; prefetch
  // the cluster at the same limit the page reads so the cache key matches (#513).
  loader: ({ context: { queryClient }, params: { moodId } }) =>
    prefetchMediaRows(queryClient, watchlistMoodItemsSource(moodId as MoodId, MOOD_PAGE_LIMIT)),
  errorComponent: WatchlistRouteError,
  component: () => <WatchlistMoodPage />,
});
