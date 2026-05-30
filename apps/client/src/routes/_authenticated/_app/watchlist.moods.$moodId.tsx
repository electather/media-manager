import { createFileRoute, notFound } from "@tanstack/react-router";
import { z } from "zod";
import { MOOD_IDS } from "@ent-mcp/shared/watchlist";

import { WatchlistMoodPage } from "@/features/watchlist/components/watchlist-mood-page";

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
  component: () => <WatchlistMoodPage />,
});
