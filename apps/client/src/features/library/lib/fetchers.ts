import type { InferRequestType } from "hono/client";
import type {
  LibraryCollectionsResponse,
  LibraryFacetCounts,
  LibraryLens,
} from "@nama/shared/library";
import type { MediaSourceId } from "@nama/shared/media";
import { api } from "@/shared/lib/api";
import { mediaKeys } from "@/shared/media/query-keys";
import { defineMediaSource } from "@/shared/media/source";
import type { LibraryFilters } from "./types";
import { throwOnError } from "./types";

/** The query input the Hono RPC client infers for `GET /api/library/collections`. */
type CollectionsQueryInput = InferRequestType<typeof api.library.collections.$get>["query"];

/**
 * The filter axis keys. The two filter -> query transforms below walk this one
 * list rather than repeating each axis name, so a new axis is wired in one place
 * and neither transform carries a per-axis branch chain.
 */
const FILTER_AXES = [
  "kinds",
  "genres",
  "qualities",
  "servers",
  "watched",
] as const satisfies readonly (keyof LibraryFilters)[];

/**
 * Filters flattened to repeated params (`?genres=Drama&genres=Crime`).
 * Empty axes omitted to share cache entry for fully-open library.
 */
type LibraryQuery = {
  [K in keyof LibraryFilters]?: string[];
} & { cursor?: string };

/**
 * Flatten filter state to repeated-param query; empty axes omitted so absent params are open server-side.
 */
export function filtersToQuery(filters: LibraryFilters): LibraryQuery {
  const query: LibraryQuery = {};
  for (const axis of FILTER_AXES) {
    const values = filters[axis];
    if (values.length > 0) query[axis] = values;
  }
  return query;
}

/**
 * All four lenses (`az`, `timeline`, `server`, `quality`) share unified resolver at `GET /api/media/sources/:sourceId`.
 * `cursorOnNull: "firstPage"` allows bad cursors to fall back to page one.
 */
export function defineLensSource(
  lens: Exclude<LibraryLens, "collections">,
  filters: LibraryFilters,
) {
  return defineMediaSource({
    sourceId: lensSourceId(lens),
    params: lensSourceParams(filters),
    mode: "infinite",
    cursorOnNull: "firstPage",
  });
}

/** The unified-resolver source id each item lens reads under (`library-az`, …). */
function lensSourceId(lens: Exclude<LibraryLens, "collections">): MediaSourceId {
  return `library-${lens}` as MediaSourceId;
}

/**
 * Query-key prefix sweeping an item lens's source across every filter variant.
 * Retry/refresh resets this so a failed lens read refetches, not all of media.
 */
export function lensResetKey(lens: Exclude<LibraryLens, "collections">) {
  return mediaKeys.sourceAll(lensSourceId(lens));
}

/**
 * Empty axes left undefined so `toQuery` drops them; each filter combination gets its own cache entry.
 */
function lensSourceParams(filters: LibraryFilters): Record<string, string[] | undefined> {
  const params: Record<string, string[] | undefined> = {};
  for (const axis of FILTER_AXES) {
    const values = filters[axis];
    params[axis] = values.length > 0 ? values : undefined;
  }
  return params;
}

/**
 * Collections response is group-first (`{ collections, cursor }`), not a `Page`.
 * Null cursor signals the last group.
 */
export async function fetchCollectionsPage(
  filters: LibraryFilters,
  cursor: string | null,
): Promise<LibraryCollectionsResponse> {
  const query = filtersToQuery(filters);
  if (cursor) query.cursor = cursor;
  // Hono infers required keys; filtersToQuery omits open axes by design.
  // Cast to bridge the gap without sending empty params.
  const res = await api.library.collections.$get({
    query: query as CollectionsQueryInput,
  });
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as LibraryCollectionsResponse;
}

/**
 * Fetch unfiltered facet totals; drives popover badges, A→Z rail, and timeline decade markers.
 */
export async function fetchFacets(): Promise<LibraryFacetCounts> {
  const res = await api.library.facets.$get();
  if (!res.ok) await throwOnError(res);
  return (await res.json()) as LibraryFacetCounts;
}
