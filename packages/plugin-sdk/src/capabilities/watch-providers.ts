import { z } from "zod";
import { defineCapability, method } from "../define";
import { mediaType, DAY, HOUR } from "./shared-schemas";

const watchProviders = z.object({
  streaming: z.array(z.string()).default([]),
  rent: z.array(z.string()).default([]),
  buy: z.array(z.string()).default([]),
});

/** watchProviders@v1 — streaming/rent/buy availability per media item per region.
 *  Provider-name arrays only; does not carry deep links.
 *
 *  `region` is an ISO 3166-1 alpha-2 country code. When omitted, plugins fall
 *  back to "US" — callers that need different geography should pass the code
 *  explicitly. */
export const WatchProvidersV1 = defineCapability({
  id: "watchProviders",
  version: "v1",
  strategy: { kind: "single" },
  scope: "global",
  defaultCacheTtlSec: DAY,
  negativeCacheTtlSec: HOUR,
  defaultTimeoutMs: 10_000,
  methods: {
    getProviders: method(
      z.object({
        id: z.string(),
        type: mediaType,
        // ISO 3166-1 alpha-2; plugins default to "US" when omitted.
        region: z.string().optional(),
      }),
      watchProviders,
    ),
  },
});
