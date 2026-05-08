import { Hono } from "hono";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import { searchQuerySchema, type SearchKind } from "@ent-mcp/shared/search";
import { requireSession, sessionUserId } from "../../auth/middleware";
import { MediaService } from "../../media/service";
import { zValidator } from "../../errors/validator";

/**
 * Raw `metadata@v1.search` result shape: `{ item, score? }` where `item`
 * matches the plugin SDK `mediaItem` (id, title, year nullable, posterUrl
 * nullable, ids bundle, …). The dispatcher loses the strong type at the
 * boundary, so we narrow to the subset the menu actually needs.
 */
interface PluginSearchHit {
  item?: {
    id?: string;
    title?: string;
    type?: "movie" | "tv";
    year?: number | null;
    posterUrl?: string | null;
    overview?: string;
    genres?: string[];
    rating?: number | null;
    runtime?: number | null;
    ids?: { tmdb_id?: string };
  };
}

function pluginTypeFromKind(kind: SearchKind): "movie" | "tv" | undefined {
  return kind === "all" ? undefined : kind;
}

function buildFacets(raw: NonNullable<PluginSearchHit["item"]>): CompactMediaItem["facets"] {
  const facets: NonNullable<CompactMediaItem["facets"]> = {};
  if (raw.runtime != null) facets.runtimeMin = raw.runtime;
  if (raw.year != null) facets.releaseDate = String(raw.year);
  return Object.keys(facets).length > 0 ? facets : undefined;
}

// fallow-ignore-next-line complexity
function applyOptionalFields(
  item: CompactMediaItem,
  raw: NonNullable<PluginSearchHit["item"]>,
): void {
  if (raw.year != null) item.year = raw.year;
  if (raw.posterUrl) item.poster = raw.posterUrl;
  if (raw.overview) item.overview = raw.overview;
  // Cap at three genres to match the home-row chip strip — keeps the menu row
  // visually balanced and the wire payload small.
  if (raw.genres && raw.genres.length > 0) item.genres = raw.genres.slice(0, 3);
  if (raw.rating != null) item.rating = raw.rating;
  const facets = buildFacets(raw);
  if (facets) item.facets = facets;
}

// fallow-ignore-next-line complexity
function compactFromHit(hit: PluginSearchHit): CompactMediaItem | null {
  const raw = hit.item;
  if (!raw) return null;
  const tmdbId = raw.ids?.tmdb_id ?? raw.id;
  const mediaType = raw.type;
  if (!tmdbId || (mediaType !== "movie" && mediaType !== "tv") || !raw.title) {
    return null;
  }
  const item: CompactMediaItem = {
    id: `${mediaType}:${tmdbId}`,
    tmdbId,
    mediaType,
    title: raw.title,
  };
  applyOptionalFields(item, raw);
  return item;
}

/**
 * `GET /api/search` — dispatches `metadata@v1.search` against the user's
 * primary metadata plugin (typically TMDB) and maps the hits to the wire
 * `CompactMediaItem` shape so the command menu can share its row component
 * with the home feed.
 *
 * Asks for `limit + 1` so `hasMore` is computed without a second call.
 * Mounts under the same better-auth gate as the other `/api/*` procedures.
 */
export const searchApp = new Hono()
  .use("*", requireSession)
  .get("/", zValidator("query", searchQuerySchema), async (c) => {
    const { q, kind, limit } = c.req.valid("query");
    const userId = sessionUserId(c);
    const mediaService = new MediaService(userId);
    const hits = (await mediaService.search(
      q,
      pluginTypeFromKind(kind),
      limit + 1,
    )) as PluginSearchHit[];
    const mapped = hits
      .map(compactFromHit)
      .filter((item): item is CompactMediaItem => item !== null);
    // `hasMore` measures the post-filter slice — drops from `compactFromHit`
    // (missing tmdb id / media type / title) under-signal upstream availability.
    // Acceptable for v1: metadata plugins (TMDB) return clean shapes, so the
    // edge only fires when an upstream plugin is misbehaving.
    const hasMore = mapped.length > limit;
    const results = hasMore ? mapped.slice(0, limit) : mapped;
    return c.json({ results, hasMore });
  });
