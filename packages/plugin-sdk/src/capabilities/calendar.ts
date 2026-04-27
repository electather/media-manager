import { z } from "zod";
import { defineCapability, method } from "../define";
import { mediaItem, HOUR, MIN } from "./shared-schemas";

const upcoming = z.object({
  item: mediaItem,
  season: z.number().optional(),
  episode: z.number().optional(),
  episodeTitle: z.string().optional(),
  airsAt: z.string(),
});

export const CalendarV1 = defineCapability({
  id: "calendar",
  version: "v1",
  strategy: { kind: "aggregate" },
  scope: "user",
  defaultCacheTtlSec: HOUR,
  negativeCacheTtlSec: 5 * MIN,
  defaultTimeoutMs: 15_000,
  methods: {
    getUpcoming: method(z.object({ days: z.number().optional() }), z.array(upcoming)),
    getUpcomingMovies: method(z.object({ days: z.number().optional() }), z.array(upcoming)),
  },
});
