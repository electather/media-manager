import { z } from "zod";
import { defineCapability, method } from "../define";
import { mediaType, mediaItem, MIN } from "./shared-schemas";

const collectionEntry = z.object({
  item: mediaItem,
  addedAt: z.string(),
});

/** collection@v1 — user's owned/collected library. */
export const CollectionV1 = defineCapability({
  id: "collection",
  version: "v1",
  strategy: { kind: "aggregate" },
  scope: "user",
  defaultCacheTtlSec: 15 * MIN,
  negativeCacheTtlSec: 1 * MIN,
  defaultTimeoutMs: 15_000,
  methods: {
    getCollection: method(z.object({ type: mediaType.optional() }), z.array(collectionEntry)),
    addToCollection: method(z.array(mediaItem), z.object({ added: z.number() }), {
      invalidates: ["collection@v1"],
    }),
    removeFromCollection: method(z.array(mediaItem), z.object({ removed: z.number() }), {
      invalidates: ["collection@v1"],
    }),
  },
});
