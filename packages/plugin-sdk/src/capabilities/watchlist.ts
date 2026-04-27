import { z } from "zod";
import { defineCapability, method } from "../define";
import { mediaType, mediaItem, watchlistEntry, MIN } from "./shared-schemas";

export const WatchlistV1 = defineCapability({
  id: "watchlist",
  version: "v1",
  strategy: { kind: "aggregate" },
  scope: "user",
  defaultCacheTtlSec: 5 * MIN,
  negativeCacheTtlSec: 1 * MIN,
  defaultTimeoutMs: 15_000,
  methods: {
    getWatchlist: method(z.object({ type: mediaType.optional() }), z.array(watchlistEntry)),
    addToWatchlist: method(z.array(mediaItem), z.object({ added: z.number() }), {
      invalidates: ["watchlist@v1"],
    }),
    removeFromWatchlist: method(z.array(mediaItem), z.object({ removed: z.number() }), {
      invalidates: ["watchlist@v1"],
    }),
  },
});
