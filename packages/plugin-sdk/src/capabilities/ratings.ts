import { z } from "zod";
import { defineCapability, method } from "../define";
import { mediaType, mediaItem, MIN } from "./shared-schemas";

const ratingEntry = z.object({
  item: mediaItem,
  rating: z.number().min(0).max(10),
  ratedAt: z.string(),
});

export const RatingsV1 = defineCapability({
  id: "ratings",
  version: "v1",
  strategy: { kind: "aggregate" },
  scope: "user",
  defaultCacheTtlSec: 15 * MIN,
  negativeCacheTtlSec: 1 * MIN,
  defaultTimeoutMs: 15_000,
  methods: {
    getRatings: method(z.object({ type: mediaType.optional() }), z.array(ratingEntry)),
    setRating: method(
      z.object({ item: mediaItem, rating: z.number().min(0).max(10) }),
      z.object({ ok: z.boolean() }),
      { invalidates: ["ratings@v1"] },
    ),
    removeRating: method(z.object({ item: mediaItem }), z.object({ ok: z.boolean() }), {
      invalidates: ["ratings@v1"],
    }),
  },
});
