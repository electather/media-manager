import { z } from "zod";
import { defineCapability, method } from "../define";
import { mediaType, mediaItem, HOUR, MIN } from "./shared-schemas";

export const RecommendationsV1 = defineCapability({
  id: "recommendations",
  version: "v1",
  strategy: { kind: "aggregate" },
  scope: "user",
  defaultCacheTtlSec: 6 * HOUR,
  negativeCacheTtlSec: 5 * MIN,
  defaultTimeoutMs: 15_000,
  methods: {
    getRecommendations: method(
      z.object({ type: mediaType.optional(), limit: z.number().optional() }),
      z.array(mediaItem),
    ),
    getTrending: method(
      z.object({ type: mediaType.optional(), limit: z.number().optional() }),
      z.array(mediaItem),
    ),
    getAnticipated: method(
      z.object({ type: mediaType.optional(), limit: z.number().optional() }),
      z.array(mediaItem),
    ),
  },
});
