import { Hono } from "hono";
import type { CompactMediaItem } from "@nama/shared/home";
import { searchQuerySchema, type SearchKind } from "@nama/shared/search";
import { requireSession, sessionUserId } from "../../auth";
import { MediaService, compactFromRaw, type PluginMediaRaw } from "../../media";
import { zValidator } from "../../diagnostics/validator";

interface PluginSearchHit {
  item?: PluginMediaRaw;
}

function pluginTypeFromKind(kind: SearchKind): "movie" | "tv" | undefined {
  return kind === "all" ? undefined : kind;
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
      .map((hit) => compactFromRaw(hit.item))
      .filter((item): item is CompactMediaItem => item !== null);
    // `hasMore` measures the post-filter slice — drops from `compactFromRaw`
    // (missing tmdb id / media type / title) under-signal upstream availability.
    // Acceptable for v1: metadata plugins (TMDB) return clean shapes, so the
    // edge only fires when an upstream plugin is misbehaving.
    const hasMore = mapped.length > limit;
    const results = hasMore ? mapped.slice(0, limit) : mapped;
    return c.json({ results, hasMore });
  });
