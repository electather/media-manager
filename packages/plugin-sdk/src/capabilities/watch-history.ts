import { z } from "zod";
import { defineCapability, method } from "../define";
import { mediaItem, historyEntry, inProgressEntry, MIN } from "./shared-schemas";

export const WatchHistoryV1 = defineCapability({
  id: "watchHistory",
  version: "v1",
  strategy: { kind: "aggregate" },
  scope: "user",
  defaultCacheTtlSec: 5 * MIN,
  negativeCacheTtlSec: 1 * MIN,
  defaultTimeoutMs: 15_000,
  methods: {
    getHistory: method(
      z.object({ limit: z.number().optional(), since: z.string().optional() }),
      z.array(historyEntry),
    ),
    /**
     * `getInProgress` — used by the home feed's "Continue Watching" row.
     * Aggregate strategy: each plugin returns the items it can see; the host
     * dedupes by `(tmdbId, mediaType)` and sorts by `lastWatchedAt`, then
     * paginates with an offset cursor. `limit` is a per-plugin hint, not a
     * global cap. Plugins not implementing it surface `plugin.missing_method`,
     * which the aggregate dispatcher skips, so adding the method is
     * backward-compatible.
     */
    getInProgress: method(z.object({ limit: z.number().optional() }), z.array(inProgressEntry), {
      optional: true,
    }),
    addToHistory: method(z.array(mediaItem), z.object({ added: z.number() }), {
      invalidates: ["watchHistory@v1"],
    }),
    removeFromHistory: method(z.array(mediaItem), z.object({ removed: z.number() }), {
      invalidates: ["watchHistory@v1"],
    }),
  },
});
