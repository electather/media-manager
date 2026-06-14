import { Hono } from "hono";
import { z } from "zod";
import type { CanonicalMetadata } from "@nama/shared/catalog";
import { getCatalogService } from "../../catalog";
import { zValidator } from "../../diagnostics/validator";

/**
 * Intentionally-public, session-less trending endpoint for the pre-auth login
 * background. It has no `requireSession` middleware and lives in its own
 * isolated sub-app so exposing it leaks nothing else. The projection is
 * deliberately minimal — `{ id, title, poster }` only — and carries no facets,
 * availability, overview, watch state, or any user/session-derived field. It
 * serves the existing daily trending snapshot via cached DB reads and does no
 * per-request catalog or plugin work. Mirrors the public-config endpoint's
 * intent (see `config.ts`).
 */

const DEFAULT_LIMIT = 48;
const MIN_LIMIT = 1;
const MAX_LIMIT = 96;

/**
 * `limit` is a coerced integer that defaults to 48 and clamps to `[1, 96]`.
 * Non-numeric, missing, zero, or negative input falls back to the default:
 * `.catch` handles the non-numeric/missing cases, and the clamp transform maps
 * zero/negative (and over-max) onto the valid range.
 */
const trendingQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .catch(DEFAULT_LIMIT)
    .transform((n) => (n < MIN_LIMIT ? DEFAULT_LIMIT : Math.min(n, MAX_LIMIT))),
});

export const publicTrendingApp = new Hono().get(
  "/trending",
  zValidator("query", trendingQuerySchema),
  async (c) => {
    const { limit } = c.req.valid("query");
    // The grid is decorative, so honor the design contract: on any catalog
    // failure — including a DB error, not just an empty snapshot — return an
    // empty list with 200 rather than a 500, and let the client fall back to
    // placeholders. The login form never gates on this request either way.
    let posters: { id: string; title: string; poster: string }[] = [];
    try {
      const metas = await getCatalogService().getTrendingMetadata(limit);
      posters = metas
        .filter((m): m is CanonicalMetadata & { posterUrl: string } => Boolean(m.posterUrl))
        .map((m) => ({
          id: `${m.mediaType}:${m.tmdbId}`,
          title: m.title,
          poster: m.posterUrl,
        }));
    } catch {
      // A decorative public endpoint degrades to placeholders rather than 500ing.
    }
    return c.json({ posters }, 200, {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    });
  },
);
