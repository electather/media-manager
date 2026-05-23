import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { MOOD_IDS } from "@ent-mcp/shared/watchlist";

import { fetchCounts } from "@/features/watchlist/lib/fetchers";
import { watchlistKeys } from "@/features/watchlist/lib/query-keys";
import { WatchlistMoodPage } from "@/features/watchlist/components/watchlist-mood-page";
import { ErrorBoundary } from "@/shared/components/error-boundary";

const paramSchema = z.object({ moodId: z.enum(MOOD_IDS) });

const searchSchema = z
  .object({
    peek: z.string().optional(),
  })
  .strict();

export const Route = createFileRoute("/_authenticated/_app/watchlist/moods/$moodId")({
  params: { parse: (p) => paramSchema.parse(p), stringify: (p) => p },
  validateSearch: searchSchema,
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData({
      queryKey: watchlistKeys.counts(),
      queryFn: fetchCounts,
    }),
  component: () => (
    <ErrorBoundary>
      <WatchlistMoodPage />
    </ErrorBoundary>
  ),
});
