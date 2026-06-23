import type { ConsolaInstance } from "consola";
import type { CompactMediaItem } from "@nama/shared/home";
import { encode, type Cursor, type CursorMode } from "../cursor";
import type { RawPageToken } from "../types";

/**
 * Pagination stage (design §C/§E) with two modes: `keyset` uses source's `nextRaw`
 * hop token (source exhaustion → no cursor, invariant V.PG1); `offset` slices `[n, n+limit)`.
 * Filter runs upstream over the full set, so offset fills from the whole sorted tail
 * in a single slice (preserves #501, single-pass sparse-bucket fix). Keyset preserves
 * #500 (empty-streak → `cursor:null`).
 */

/**
 * Advisory ceiling for offset full-load scan (RISK-005). Warn at this threshold
 * so the latency trade-off (full batch on each page) becomes visible. Moved from
 * watchlist `listItemsOffset` per design §E.
 */
export const OFFSET_FULL_LOAD_WARN_ROWS = 1000;

export interface PaginateInput {
  /** Items already enriched, classified, filtered, and sorted by the pipeline. */
  items: CompactMediaItem[];
  /** The source's declared pagination mode (`source.stages.cursorMode`). */
  cursorMode: CursorMode;
  /**
   * The incoming decoded cursor. Drives the offset slice index; ignored for
   * keyset (the source already consumed it to position its raw query).
   */
  cursor: Cursor | null;
  /**
   * Keyset hop token from source. Undefined means source exhausted scan
   * (including #500 empty-streak give-up), so no cursor emitted.
   */
  nextRaw?: RawPageToken;
  /** Page size. */
  limit: number;
  /** Optional logger for the RISK-005 offset-ceiling warn. */
  log?: ConsolaInstance;
}

export interface PaginateResult {
  items: CompactMediaItem[];
  /** Encoded next-page cursor, or `null` when the set is exhausted. */
  cursor: string | null;
}

export function paginate(input: PaginateInput): PaginateResult {
  return input.cursorMode === "keyset" ? paginateKeyset(input) : paginateOffset(input);
}

function paginateKeyset(input: PaginateInput): PaginateResult {
  // Guard limit <= 0: an empty slice paired with a live `nextRaw` would mint a
  // cursor for an empty page and loop the client forever. Real callers clamp
  // (watchlist `clampLimit`, home `ROW_PAGE_SIZE`); this is defense-in-depth.
  const items = input.items.slice(0, Math.max(1, input.limit));
  // #500 (V.PG1): the source signals exhaustion — including the empty-streak
  // give-up where it scanned its hop budget without collecting a match — by
  // omitting `nextRaw`. Emit no cursor so the client shows no phantom
  // load-more affordance. Otherwise mint the next keyset cursor from the
  // source's opaque hop token (it owns the resume position).
  const cursor = input.nextRaw === undefined ? null : encode({ mode: "keyset", k: input.nextRaw });
  return { items, cursor };
}

function warnIfOverCeiling(input: PaginateInput): void {
  if (input.log && input.items.length > OFFSET_FULL_LOAD_WARN_ROWS) {
    input.log.warn(
      `[media:paginate] full-load scan over ${input.items.length} rows exceeds advisory ${OFFSET_FULL_LOAD_WARN_ROWS}-row ceiling (RISK-005)`,
    );
  }
}

function paginateOffset(input: PaginateInput): PaginateResult {
  warnIfOverCeiling(input);
  const start = input.cursor?.mode === "offset" ? input.cursor.n : 0;
  // Guard limit <= 0 (see paginateKeyset): a zero-width slice would re-mint the
  // same offset cursor and loop.
  const items = input.items.slice(start, start + Math.max(1, input.limit));
  const nextOffset = start + items.length;
  // #501 (V.PG1): `filter` already ran over the full set upstream, so this
  // slice fills the page from the whole sorted tail — no bounded overshoot
  // window can strand matches further down. A short final page (or a cursor
  // past the end) advances `nextOffset` to the set length and emits no cursor.
  const cursor = nextOffset < input.items.length ? encode({ mode: "offset", n: nextOffset }) : null;
  return { items, cursor };
}
