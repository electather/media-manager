import { z } from "zod";
import { defineCapability, method } from "../define";
import { mediaType, DAY, HOUR } from "./shared-schemas";

const videoEntry = z.object({
  kind: z.enum(["trailer", "teaser", "clip", "featurette", "other"]),
  site: z.string(),
  key: z.string(),
  // Null for sites we don't know how to build a URL for — the raw `key` and
  // `site` are still available for callers that recognise other providers.
  url: z.string().nullable(),
  official: z.boolean().optional(),
});

/** trailers@v1 — trailer/teaser/clip videos per media item. */
export const TrailersV1 = defineCapability({
  id: "trailers",
  version: "v1",
  strategy: { kind: "single" },
  scope: "global",
  defaultCacheTtlSec: DAY,
  negativeCacheTtlSec: HOUR,
  defaultTimeoutMs: 10_000,
  methods: {
    getVideos: method(z.object({ id: z.string(), type: mediaType }), z.array(videoEntry)),
  },
});
