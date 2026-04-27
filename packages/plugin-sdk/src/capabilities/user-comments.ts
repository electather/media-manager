import { z } from "zod";
import { defineCapability, method } from "../define";
import { mediaItem, MIN } from "./shared-schemas";

const commentEntry = z.object({
  item: mediaItem,
  text: z.string(),
  createdAt: z.string(),
});

export const UserCommentsV1 = defineCapability({
  id: "userComments",
  version: "v1",
  strategy: { kind: "aggregate" },
  scope: "user",
  defaultCacheTtlSec: 15 * MIN,
  negativeCacheTtlSec: 1 * MIN,
  defaultTimeoutMs: 15_000,
  methods: {
    getComments: method(z.object({ limit: z.number().optional() }), z.array(commentEntry)),
  },
});
