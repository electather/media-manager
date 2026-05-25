import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { WatchlistCuratedPage } from "@/features/watchlist/components/watchlist-curated-page";

const searchSchema = z
  .object({
    peek: z.string().optional(),
  })
  .strict();

export const Route = createFileRoute("/_authenticated/_app/watchlist/")({
  validateSearch: searchSchema,
  component: () => <WatchlistCuratedPage />,
});
