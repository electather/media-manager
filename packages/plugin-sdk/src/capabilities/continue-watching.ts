import { z } from "zod";
import { libraryItemSchema } from "@ent-mcp/shared/plugins/library";
import { defineCapability, method } from "../define";
import { MIN } from "./shared-schemas";
import { libraryItemQueryType } from "./library-availability";

const continueWatchingInput = z.object({
  type: libraryItemQueryType.optional(),
  limit: z.number().optional(),
});

const continueWatchingEntry = z.object({
  /** The thing to resume or start — an episode for shows, a movie for movies. */
  item: libraryItemSchema,
  /**
   * Progress into `item` in milliseconds. Absent when this is a "start next
   * episode" entry with no prior position on the server.
   */
  progressMs: z.number().optional(),
  /** For TV: the episode after `item` when the server surfaces one. */
  nextUp: libraryItemSchema.optional(),
  /** ISO timestamp of the most recent playback on `item`, for cross-feed sort. */
  lastPlayedAt: z.string().optional(),
});

export type ContinueWatchingEntry = z.infer<typeof continueWatchingEntry>;

/**
 * continueWatching@v1 — the server's own "pick up where you left off" feed,
 * including Next Up episode stitching. Distinct from `playback@v1`, which
 * returns raw resume points from external sync APIs (Trakt) rather than a
 * server-curated ranking. Reuses `LibraryItem` so sessions and continue feeds
 * nest the same media shape.
 *
 * No `mcpTools` in this revision — they land with the Plex/Jellyfin plugin
 * implementations (#22, #23).
 */
export const ContinueWatchingV1 = defineCapability({
  id: "continueWatching",
  version: "v1",
  strategy: { kind: "aggregate" },
  scope: "user",
  defaultCacheTtlSec: 5 * MIN,
  negativeCacheTtlSec: 1 * MIN,
  defaultTimeoutMs: 15_000,
  methods: {
    getContinueWatching: method(continueWatchingInput, z.array(continueWatchingEntry)),
  },
});
