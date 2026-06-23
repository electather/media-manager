import { z } from "zod";
import { defineCapability, method } from "../define";
import { mediaType, DAY, HOUR } from "./shared-schemas";

/**
 * Id kinds: cross-service (`tmdb`, `tvdb`, `trakt`, `imdb`) are globally
 * meaningful; server-local (`plex:ratingKey`, `jellyfin:itemId`) belong to a
 * user's media server, resolvable only by user-scoped plugins.
 */
const idKinds = z.enum(["tmdb", "tvdb", "trakt", "imdb", "plex:ratingKey", "jellyfin:itemId"]);

export type IdResolveKind = z.infer<typeof idKinds>;

const idResolveInput = z.object({
  from: idKinds,
  id: z.string(),
  type: mediaType,
});

const idResolveOutput = z.object({
  tmdb: z.string().optional(),
  tvdb: z.string().optional(),
  trakt: z.string().optional(),
  imdb: z.string().optional(),
  "plex:ratingKey": z.string().optional(),
  "jellyfin:itemId": z.string().optional(),
});

/**
 * Internal-only, mixed-scope: routes by `from` field (`:` = user-scoped Plex/Jellyfin,
 * no `:` = global Trakt/TMDB/TVDB). Prevents user-A resolutions leaking to user-B via cache.
 */
export const IdResolveV1 = defineCapability({
  id: "idResolve",
  version: "v1",
  strategy: { kind: "single" },
  scope: "mixed",
  scopeForInput: (input: unknown) => {
    // `from` is validated by `idResolveInput` before this, so the assertion is
    // safe for well-formed requests. Defensive `typeof` for edge cases (e.g.
    // direct dispatcher calls from tests). Classifier rule: `:` = user-scoped,
    // no `:` = global. z.enum means adding a new colon-bearing global kind
    // requires explicit code change here, not silent flip.
    const from = (input as { from?: unknown } | null)?.from;
    return typeof from === "string" && from.includes(":") ? "user" : "global";
  },
  defaultCacheTtlSec: 7 * DAY,
  negativeCacheTtlSec: HOUR,
  defaultTimeoutMs: 10_000,
  methods: {
    resolve: method(idResolveInput, idResolveOutput),
  },
});
