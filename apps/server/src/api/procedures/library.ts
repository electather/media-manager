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
 * Builds the loose per-request context the library service consumes. Carries the
 * per-user `MediaService` (the eager-seed path reaches `getCollectionFeed`
 * through it) and the catalog handle the future filtered reads need, plus the
 * shared logger. `getFacets` only reads the projection, but the context shape is
 * the module's single `MaybeLibraryContext`, so it is built whole here.
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
 * The library read routes (design §API routes): `/facets` (unfiltered totals)
 * and `/collections` (group-first owned franchises). The item lenses
 * (`library-az` / `library-timeline` / `library-server` / `library-quality`)
 * serve through the unified `GET /api/media/sources/:sourceId` resolver via the
 * `libraryMediaSources` registrations, so they are NOT mounted here.
 *
 * Both routes reuse the shared read `TokenBucketLimiter` (`watchlistReadLimiter`,
 * the read-family bucket the §A7 cutover centralized) so the library reads share
 * the same per-user read budget as the rest of the media surface, and both sit
 * behind `requireSession`. The read limit is applied once at the router level
 * (after `requireSession`, before either handler) so both routes debit the same
 * per-user bucket identically.
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
