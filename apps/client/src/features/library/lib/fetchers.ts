import type { InferRequestType } from "hono/client";
import type {
  LibraryCollectionsResponse,
  LibraryFacetCounts,
  LibraryLens,
} from "@nama/shared/library";
import type { MediaSourceId } from "@nama/shared/media";
import { api } from "@/shared/lib/api";
import { defineMediaSource } from "@/shared/media/source";
import type { LibraryFilters } from "./types";
import { throwOnError } from "./types";

/** The query input the Hono RPC client infers for `GET /api/library/collections`. */
type CollectionsQueryInput = InferRequestType<typeof api.library.collections.$get>["query"];

/**
 * The query shape every library read accepts: the active facet filters flattened
 * to the repeated-param encoding the server's tolerant `arrayParam` schema
 * parses (`?genres=Drama&genres=Crime`). Each axis is optional (an empty axis is
 * dropped entirely so a fully-open library hits a bare endpoint and shares one
 * cache entry) plus the paginated callers' `cursor`. Named optional keys (not an
 * index signature) so the object is assignable to the Hono client's inferred
 * query type for the collections route. `limit` is threaded by the callers that
 * paginate.
 */
type LibraryQuery = {
  [K in keyof LibraryFilters]?: string[];
} & { cursor?: string };

/**
 * Flatten the URL-derived filter state into the repeated-param query the library
 * endpoints expect. Hono serializes a string-array value as repeated params, and
 * the shared `libraryLensQuerySchema` / `libraryCollectionsQuerySchema` coerce a
 * lone value back to a one-element array — so multi-value axes round-trip without
 * the single-value collapse the phase-2 sketch warned about. Empty axes are
 * omitted (an absent param is an open axis server-side).
 */
export function filtersToQuery(filters: LibraryFilters): LibraryQuery {
  const query: LibraryQuery = {};
  if (filters.kinds.length > 0) query.kinds = filters.kinds;
  if (filters.genres.length > 0) query.genres = filters.genres;
  if (filters.qualities.length > 0) query.qualities = filters.qualities;
  if (filters.servers.length > 0) query.servers = filters.servers;
  if (filters.watched.length > 0) query.watched = filters.watched;
  return query;
}

/**
 * Build the shared `ClientMediaSource` for one item lens (`az`/`timeline`/
 * `server`/`quality`). The four lenses serve through the unified
 * `GET /api/media/sources/:sourceId` resolver, so they reuse `defineMediaSource`
 * (the one bound media-read fetcher) rather than a per-lens fetch — the cursor
 * rides as a query param and the resolver re-parses the filter params off the
 * query. `cursorOnNull: "firstPage"` matches the server registrations (a bad/
 * absent cursor falls to page one instead of 400-ing).
 *
 * `params` carries the flattened filters so `mediaRowsQueryOptions` folds them
 * into the cache key — each filter combination gets its own entry. The
 * `library-collections` id is excluded: collections is not a media source (it
 * has its own endpoint + response shape).
 *
 * MULTI-VALUE LIMITATION (carried over from phase 2, surfaced loudly per rule
 * 12): the unified source route parses its filters with `c.req.query()`
 * (single-value) inside the handler — NOT `c.req.queries()` — so a repeated
 * param collapses to one value server-side, and the shared `defineMediaSource`
 * `toQuery` forwards only string/number values (it drops arrays). So each lens
 * axis is sent as its FIRST selected value; selecting two genres filters by the
 * first only. The collections + facets endpoints (their own routes, validated
 * with `c.req.queries()`) DO honor multi-value. Settling true multi-value on the
 * lens path is a server change (read `queries()` + split) tracked as a followup.
 */
export function defineLensSource(
  lens: Exclude<LibraryLens, "collections">,
  filters: LibraryFilters,
) {
  const sourceId = `library-${lens}` as MediaSourceId;
  return defineMediaSource({
    sourceId,
    params: lensSourceParams(filters),
    mode: "infinite",
    cursorOnNull: "firstPage",
  });
}

/**
 * The flat single-value params `defineMediaSource.toQuery` forwards. Each axis
 * sends its first selected value (the unified source route collapses repeated
 * params to one anyway — see {@link defineLensSource}); an empty axis is left
 * undefined so `toQuery` drops it. The whole object is still folded into the
 * cache key, so two different first-values are two cache entries.
 */
function lensSourceParams(filters: LibraryFilters): Record<string, string | undefined> {
  const first = (values: string[]): string | undefined => values[0];
  return {
    kinds: first(filters.kinds),
    genres: first(filters.genres),
    qualities: first(filters.qualities),
    servers: first(filters.servers),
    watched: first(filters.watched),
  };
}

/**
 * Fetch one page of the Collections lens (`GET /api/library/collections`).
 * Group-first server-side: the response is `{ collections, cursor }`, not a
 * media `Page`, so it has its own thin fetcher (the shared media source only
 * speaks `Page<CompactMediaItem>`). The opaque `cursor` threads forward; a null
 * `cursor` in the response signals the last group.
 */
export async function fetchCollectionsPage(
  filters: LibraryFilters,
  cursor: string | null,
): Promise<LibraryCollectionsResponse> {
  const query = filtersToQuery(filters);
  if (cursor) query.cursor = cursor;
  // The Hono RPC types every filter axis as a required query key (the zod
  // `arrayParam` is output-optional but the inferred input is not), while
  // `filtersToQuery` omits open axes by design. The server schema tolerates an
  // absent axis (`arrayParam` → undefined → no filter), so the omission is
  // correct on the wire — cast to the inferred input to bridge the
  // required-key/optional-key gap without sending empty params.
  const res = await api.library.collections.$get({
    query: query as CollectionsQueryInput,
  });
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as LibraryCollectionsResponse;
}

/**
 * Fetch the unfiltered facet totals (`GET /api/library/facets`). Non-paginated
 * and not filter-aware (totals match the mock look), so it takes no params; the
 * header reads it once via a non-blocking `useQuery` to drive the popover badges,
 * the A→Z letter rail, and the timeline decade markers.
 */
export async function fetchFacets(): Promise<LibraryFacetCounts> {
  const res = await api.library.facets.$get();
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as LibraryFacetCounts;
}
