import type { ActiveRow } from "@nama/shared/media";
import type { Cursor, CursorMode } from "./cursor";
import type { FilterKind, PipelineSort, RawPageToken, SourceContext } from "./types";

/**
 * Design §B: source produces raw rows; pipeline (§C) owns enrich/classify/filter/sort/paginate (V.MC1, RISK-101).
 * Watchlist sources emit ActiveRow (shared enrich); ephemeral feeds emit own shape,
 * enriched home-side (V.RG1). Owned by consumer modules, not media.
 */
export interface MediaSource<P = void, Row = ActiveRow> {
  /** Stable slug, unique across a consumer's source registry. */
  sourceId: string;
  /**
   * Produce raw rows for one page — the ONLY per-source difference (V.MC1).
   * `partial: true` signals plugin soft-failure; `nextRaw` is the keyset hop token for pagination.
   */
  fetchRawSet(
    ctx: SourceContext,
    params: P,
    cursor: Cursor | null,
  ): Promise<{ rows: Row[]; partial: boolean; nextRaw?: RawPageToken }>;
  /** Declares which pipeline stages run and how the source paginates. */
  stages: {
    /**
     * Run bucket classification. Required for `filter: "bucket"` — without it the filter is a silent no-op.
     */
    classify?: boolean;
    /** Apply a `bucket`/`mood` predicate (driven by params); `undefined` skips. */
    filter?: FilterKind;
    /**
     * Default sort; `cfg.sort` may override when a source allows it. `"none"`
     * is an identity sort for a source that already returned rows in final
     * order (a metadata-presorted offset source or a pre-ranked feed).
     */
    sort: PipelineSort;
    /** `keyset` hops the raw query via `nextRaw`; `offset` slices the sorted set. */
    cursorMode: CursorMode;
  };
}
