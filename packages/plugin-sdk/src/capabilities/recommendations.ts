import { z } from "zod";
import { defineCapability, method } from "../define";
import { mediaListQuery, mediaItem, HOUR, MIN } from "./shared-schemas";

export const RecommendationsV1 = defineCapability({
  id: "recommendations",
  version: "v1",
  strategy: { kind: "aggregate" },
  scope: "user",
  defaultCacheTtlSec: 6 * HOUR,
  negativeCacheTtlSec: 5 * MIN,
  defaultTimeoutMs: 15_000,
  methods: {
    getRecommendations: method(mediaListQuery, z.array(mediaItem)),
    getTrending: method(mediaListQuery, z.array(mediaItem)),
    getAnticipated: method(mediaListQuery, z.array(mediaItem)),
  },
});
