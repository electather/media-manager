import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { WATCHLIST_SORTS } from "@ent-mcp/shared/watchlist";

import { WatchlistFlatPage } from "@/features/watchlist/components/watchlist-flat-page";

const searchSchema = z
  .object({
    sort: z.enum(WATCHLIST_SORTS).optional(),
    peek: z.string().optional(),
  })
  .strict();

export const Route = createFileRoute("/_authenticated/_app/watchlist/awaiting")({
  validateSearch: searchSchema,
  component: () => <WatchlistFlatPage bucket="awaiting" />,
});
