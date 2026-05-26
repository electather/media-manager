import type { ActiveRow, RowSort } from "@ent-mcp/shared/media";
import type { Cursor } from "./cursor";
import type { FilterKind, RawPageToken, SourceContext } from "./types";

/**
 * The generalized row contract (design §B), replacing the home `RowProvider`.
 * A source's only job is to produce a RAW row set — the shared pipeline
 * (`listRows`, §C) owns enrich/classify/filter/sort/paginate. The interface is
 * deliberately tiny: per-source variation rides in `params` (`P`) and the
 * closure inside `fetchRawSet`, never in the contract (invariant V.MC1, guards
 * RISK-101). Eligibility is a consumer-side concern and is NOT on the source.
 *
 * Concrete sources are owned and registered by the consumer module that uses
 * them (home/watchlist); media never imports a concrete source (invariant
 * V.RG1).
 */
export interface MediaSource<P = void> {
  /** Stable slug, unique across a consumer's source registry. */
  sourceId: string;
  /**
   * Produce the raw row set for one page — the ONLY thing that differs between
   * sources (a persistent-table query or an ephemeral plugin feed). It carries
   * no enrich/classify/sort/slice/cursor logic (invariant V.MC1).
   *
   * `partial: true` signals a plugin soft-failed; it propagates through the
   * pipeline so the consumer envelope can degrade gracefully. `nextRaw` is the
   * keyset hop token the `paginate` stage mints the next cursor from; offset
   * sources leave it undefined.
   */
  fetchRawSet(
    ctx: SourceContext,
    params: P,
    cursor: Cursor | null,
  ): Promise<{ rows: ActiveRow[]; partial: boolean; nextRaw?: RawPageToken }>;
  /** Declares which pipeline stages run and how the source paginates. */
  stages: {
    /** Run bucket classification over the enriched items. */
    classify?: boolean;
    /** Apply a `bucket`/`mood` predicate (driven by params); `undefined` skips. */
    filter?: FilterKind;
    /** Default sort; `cfg.sort` may override when a source allows it. */
    sort: RowSort;
    /** `keyset` hops the raw query via `nextRaw`; `offset` slices the sorted set. */
    cursorMode: "keyset" | "offset";
  };
}
