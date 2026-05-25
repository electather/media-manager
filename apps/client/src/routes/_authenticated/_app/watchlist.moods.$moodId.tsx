import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { MOOD_IDS } from "@ent-mcp/shared/watchlist";

import { WatchlistMoodPage } from "@/features/watchlist/components/watchlist-mood-page";

const paramSchema = z.object({ moodId: z.enum(MOOD_IDS) });

const searchSchema = z
  .object({
    peek: z.string().optional(),
  })
  .strict();

export const Route = createFileRoute("/_authenticated/_app/watchlist/moods/$moodId")({
  params: { parse: (p) => paramSchema.parse(p), stringify: (p) => p },
  validateSearch: searchSchema,
  component: () => <WatchlistMoodPage />,
});
