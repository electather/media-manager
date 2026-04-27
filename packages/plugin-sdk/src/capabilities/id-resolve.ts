import { z } from "zod";
import { defineCapability, method } from "../define";
import { mediaType, DAY, HOUR } from "./shared-schemas";

/**
 * Id kinds accepted by `idResolve@v1`.
 *
 * Cross-service ids (`tmdb`, `tvdb`, `trakt`, `imdb`) are globally meaningful
 * and typically resolved by global plugins. Server-local ids
 * (`plex:ratingKey`, `jellyfin:itemId`) belong to a specific user's media
 * server and are only resolvable by user-scoped plugins with access to that
 * server.
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
 * Internal-only capability: not invoked directly by callers — only by
 * MediaService id_map gap-fill.
 *
 * **Mixed-scope.** Global plugins (Trakt/TMDB/TVDB) own cross-service id
 * resolution; user-scoped plugins (Plex/Jellyfin) own server-local ids
 * (`plex:ratingKey`, `jellyfin:itemId`). `scopeForInput` classifies the
 * request by the `from` field: values containing `:` are server-local and
 * route to user-scoped providers; flat id kinds (`tmdb`, `tvdb`, `trakt`,
 * `imdb`) route globally. The dispatcher uses this classification for both
 * provider lookup and cache keying, so a server-local resolution done for
 * user A cannot be served back to user B from the global cache.
 */
export const IdResolveV1 = defineCapability({
  id: "idResolve",
  version: "v1",
  strategy: { kind: "single" },
  scope: "mixed",
  scopeForInput: (input: unknown) => {
    // `from` is validated by `idResolveInput` before this runs (see
    // `strategy` pipeline), so the type assertion is safe for well-formed
    // requests. Defensive `typeof` guard for edge cases where validation
    // has been bypassed (e.g. direct dispatcher calls from tests).
    //
    // Classifier rule: server-local id kinds are the ones that contain
    // `":"` (`plex:ratingKey`, `jellyfin:itemId`). Cross-service id kinds
    // (`tmdb`, `imdb`, `tvdb`, `trakt`) are flat — no colon — and route
    // globally. Because `idResolveInput` uses `z.enum`, adding a new
    // colon-bearing global id kind later would require an explicit code
    // change here, not a silent classification flip.
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
