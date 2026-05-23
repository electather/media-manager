import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { MOOD_IDS, WATCHLIST_BUCKETS, WATCHLIST_SORTS } from "@ent-mcp/shared/watchlist";

import { fetchCounts } from "@/features/watchlist/lib/fetchers";
import { watchlistKeys } from "@/features/watchlist/lib/query-keys";
import { WatchlistAllPage } from "@/features/watchlist/components/watchlist-all-page";
import { ErrorBoundary } from "@/shared/components/error-boundary";

const searchSchema = z
  .object({
    sort: z.enum(WATCHLIST_SORTS).optional(),
    bucket: z.enum(WATCHLIST_BUCKETS).optional(),
    mood: z.enum(MOOD_IDS).optional(),
    peek: z.string().optional(),
  })
  .strict();

export const Route = createFileRoute("/_authenticated/_app/watchlist/all")({
  validateSearch: searchSchema,
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData({
      queryKey: watchlistKeys.counts(),
      queryFn: fetchCounts,
    }),
  component: () => (
    <ErrorBoundary>
      <WatchlistAllPage />
    </ErrorBoundary>
  ),
});
