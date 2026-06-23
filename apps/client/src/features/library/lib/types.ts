import type { WatchedState } from "@nama/shared/library";
import type { CompactMediaItem, MediaType } from "@nama/shared/media";
import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { throwOnApiError } from "@/shared/lib/api/throw-on-error";

/** Alias for `CompactMediaItem`; new code should import from `@nama/shared/media` directly. */
export type LibraryItem = CompactMediaItem;

/** UI-local filter state hydrated from URL; shared enums imported directly (never re-exported). */
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

/** Mirrors `MediaApiError` to unify error handling across lens, collections, and facets reads. */
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

/** Delegates to shared `throwOnApiError` bound to `LibraryApiError`. */
export async function throwOnError(res: Response): Promise<never> {
  return throwOnApiError(res, LibraryApiError);
}
