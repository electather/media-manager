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
     * Home feed "Continue Watching" row. Aggregate strategy: each plugin returns visible
     * items, host dedupes by (tmdbId, mediaType) and sorts by lastWatchedAt, then
     * paginates via offset cursor. `limit` is per-plugin hint, not global cap.
     * Missing plugins surface plugin.missing_method (skipped); backward-compatible.
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
