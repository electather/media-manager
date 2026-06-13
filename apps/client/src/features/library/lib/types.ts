import type { WatchedState } from "@nama/shared/library";
import type { CompactMediaItem, MediaType } from "@nama/shared/media";
import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { throwOnApiError } from "@/shared/lib/api/throw-on-error";

/**
 * The library renders the shared wire item directly — quality tiers ride on
 * `tags` and server availability on `availability.servers`, so no feature-local
 * extension is needed. Kept as an alias the card/grid components read; new code
 * should import `CompactMediaItem` from `@nama/shared/media` directly.
 */
export type LibraryItem = CompactMediaItem;

/**
 * The facet axes a user can narrow the catalog by, in addition to free-text
 * search. This is UI-local filter state (the URL search params hydrate it), so
 * it stays in the feature; the lens/quality/watched tuples it draws from live
 * in `@nama/shared/library` and are imported directly (never re-exported
 * through this module — see the shared-package rules).
 */
export interface LibraryFilters {
  kinds: MediaType[];
  genres: string[];
  qualities: string[];
  servers: string[];
  watched: WatchedState[];
}

/** An empty filter set — every axis open. */
export const EMPTY_FILTERS: LibraryFilters = {
  kinds: [],
  genres: [],
  qualities: [],
  servers: [],
  watched: [],
};

/**
 * The one client-side library error (rule 3, mirrors the shared media
 * `MediaApiError`). Every library read — the lens pages routed through the
 * shared media source, the collections feed, and the facets query — surfaces
 * the same typed envelope: the HTTP `status`, the parsed `body`, and the stable
 * `code` the ErrorBoundary keys its retry copy off.
 *
 * The lens pages reuse the shared media source (`defineMediaSource`), which
 * throws `MediaApiError`; the collections + facets fetchers below throw this.
 * Both extend `Error` with the identical `{ status, body, code }` surface, so a
 * shared boundary handles either uniformly.
 */
export class LibraryApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | null;
  readonly code: string | undefined;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.message ?? body?.devMessage ?? `library request failed (${status})`);
    this.name = "LibraryApiError";
    this.status = status;
    this.body = body;
    this.code = typeof body?.code === "string" ? body.code : undefined;
  }
}

/**
 * The one library `throwOnError` tail. Delegates to the shared
 * `throwOnApiError` idiom (so this module carries no local copy of the
 * read-envelope-and-throw dance) bound to {@link LibraryApiError}. The
 * collections + facets fetchers call this on a non-OK response.
 */
export async function throwOnError(res: Response): Promise<never> {
  return throwOnApiError(res, LibraryApiError);
}
