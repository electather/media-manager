import { Hono } from "hono";
import { consola } from "consola";
import {
  libraryCollectionsQuerySchema,
  type LibraryCollectionsResponse,
  type LibraryFacetCounts,
} from "@nama/shared/library";
import { requireSession, sessionUserId } from "../../auth";
import { getCatalogService } from "../../catalog";
import { zValidator } from "../../diagnostics/validator";
import { getFacets, listCollections } from "../../library";
import { MediaService } from "../../media";
import { makeRateLimitMiddleware } from "../rate-limit";
import { watchlistReadLimiter } from "./media";

/** Per-request plugin-call deadline for the library reads, matching the watchlist bridges. */
const LIBRARY_REQUEST_DEADLINE_MS = 5000;

/**
 * Per-request library context: `MediaService`, catalog handle, logger, and
 * deadline. Built whole here even though `getFacets` only needs the projection.
 */
function buildLibraryContext(userId: string) {
  return {
    userId,
    mediaService: new MediaService(userId),
    catalog: getCatalogService(),
    deadlineMs: LIBRARY_REQUEST_DEADLINE_MS,
    log: consola,
  };
}

/**
 * Routes: `/facets` (unfiltered totals) and `/collections` (owned franchises), per design §API routes.
 * Item lenses (library-az/timeline/server/quality) use `GET /api/media/sources/:sourceId` instead.
 * Both reuse `watchlistReadLimiter` (the read-family bucket from §A7 cutover) so media reads share the same per-user budget.
 */
export const libraryApp = new Hono()
  .use("*", requireSession)
  .use("*", makeRateLimitMiddleware({ limiter: watchlistReadLimiter }))
  .get("/facets", async (c) => {
    const userId = sessionUserId(c);
    const facets: LibraryFacetCounts = await getFacets(buildLibraryContext(userId));
    return c.json(facets);
  })
  .get("/collections", zValidator("query", libraryCollectionsQuerySchema), async (c) => {
    const userId = sessionUserId(c);
    const response: LibraryCollectionsResponse = await listCollections(
      buildLibraryContext(userId),
      c.req.valid("query"),
    );
    return c.json(response);
  });
