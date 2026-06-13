import type { MediaSourceId } from "@nama/shared/media";
import { type ClientMediaSource, defineMediaSource } from "@/shared/media/source";

/**
 * Home rows take no query params — the seed for `becauseYouWatched` /
 * `similarTo` rides inside the opaque cursor, which the resolver decodes
 * separately (server `homeMediaSources` registers every row with
 * `voidParamsSchema`). The empty param object keeps the cache key
 * (`mediaKeys.source(rowId, {})`) stable per row.
 */
export type HomeRowParams = Record<string, never>;

/**
 * Build the `ClientMediaSource` for a `/home/layout` row stub (design §B3).
 * The stub's `rowId` is a `MediaSourceId`, so it maps straight onto the shared
 * resolver (`GET /api/media/sources/:sourceId`); `initialCursor` carries the
 * server-minted seed cursor for the seeded rows and is threaded as the first
 * page param. `cursorOnNull: "throw"` mirrors the server registration's
 * `"400"` policy — a bad/foreign cursor is rejected rather than reset to page
 * one (invariant V.CU1).
 *
 * `rowId` is typed `MediaSourceId` (not raw `string`) so a layout stub that
 * never narrowed at the wire boundary cannot silently flow an unknown slug into
 * the resolver — the cast lives once in `toRowData`, against the deliberately
 * opaque wire `rowId`.
 */
export function homeRowSource(
  rowId: MediaSourceId,
  initialCursor: string | null,
): ClientMediaSource<HomeRowParams> {
  return defineMediaSource<HomeRowParams>({
    sourceId: rowId,
    params: {},
    mode: "infinite",
    cursorOnNull: "throw",
    initialCursor,
  });
}
