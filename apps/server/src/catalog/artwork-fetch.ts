import { consola } from "consola";
import type { ArtworkBundle, ArtworkIdMap } from "@ent-mcp/shared/artwork";
import type { MediaType } from "@ent-mcp/shared/media";
import { dispatchAggregatePerKind } from "../media/strategies/aggregate-per-kind";
import type { IdMap, MetadataKey } from "./types";

/**
 * Fetches an `artwork@v1` bundle for one canonical key, tolerating every
 * failure mode by returning `null`. Per V46 the bundle is best-effort: an
 * `artwork.unsupported_id_combo`, dispatcher fault, or empty provider set
 * must not fail the surrounding metadata write — the caller falls back to
 * raw payload artwork fields when this returns `null`.
 *
 * `userId` is the caller scope; `artwork@v1` is global-scope so the value
 * matters only for context tagging (cold-fill threads the request user;
 * the metadata-refresh job uses `SYSTEM_USER_ID`).
 *
 * The two-pass behaviour required by V46 falls out of `ids` shape: a fresh
 * `tmdbId` with no `id_map` row dispatches with `{ tmdb }` only and only
 * TMDB-backed providers serve, so logos/thumbs come back empty. After
 * `idResolve@v1` populates the row, the next refresh passes `{ tmdb, imdb,
 * tvdb }` and fanart.tv / TVDB providers can contribute.
 */
export async function fetchArtworkBundle(
  userId: string,
  key: MetadataKey,
  ids: ArtworkIdMap,
): Promise<ArtworkBundle | null> {
  try {
    return await dispatchAggregatePerKind<ArtworkBundle>({
      userId,
      capability: "artwork",
      version: "v1",
      method: "getArtwork",
      input: { ids, type: key.type, languages: ["en", "00"] },
    });
  } catch (err) {
    consola.debug(`[catalog:artwork-fetch] dispatch failed for ${key.type}:${key.tmdbId}`, err);
    return null;
  }
}

/**
 * Maps the persisted `id_map` shape onto the `artwork@v1` request shape.
 * Drops empty/null values so `artworkIdMapSchema` (which requires at least
 * one id) accepts the result. Always includes `tmdb` since that is the
 * canonical key.
 */
export function toArtworkIds(tmdbId: string, ids: IdMap | null): ArtworkIdMap {
  const out: ArtworkIdMap = { tmdb: tmdbId };
  if (ids?.imdbId) out.imdb = ids.imdbId;
  if (ids?.tvdbId) out.tvdb = ids.tvdbId;
  return out;
}

export type { MediaType };
