import { z } from "zod";
import { defineCapability, method } from "../define";
import { mediaType, mediaItem, MIN } from "./shared-schemas";

const playbackPosition = z.object({
  item: mediaItem,
  progress: z.number().min(0).max(100),
  pausedAt: z.string(),
  season: z.number().optional(),
  episode: z.number().optional(),
  playbackId: z.string(),
});

/** playback@v1 — cross-device resume positions. */
export const PlaybackV1 = defineCapability({
  id: "playback",
  version: "v1",
  strategy: { kind: "aggregate" },
  scope: "user",
  defaultCacheTtlSec: 1 * MIN,
  negativeCacheTtlSec: 30,
  defaultTimeoutMs: 15_000,
  methods: {
    getPositions: method(z.object({ type: mediaType.optional() }), z.array(playbackPosition)),
    removePosition: method(z.object({ playbackId: z.string() }), z.object({ ok: z.boolean() }), {
      invalidates: ["playback@v1"],
    }),
  },
});
