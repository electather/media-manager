import type { ZodType } from "zod";
import type { ActiveRow, MediaSourceId } from "@ent-mcp/shared/media";
import type { Cursor, CursorMode } from "../cursor";
import type { MediaSource } from "../source";
import type { PipelineConfig, SourceContext } from "../types";
import type { EnrichRowsFn } from "./list-rows";

/**
 * The pipeline pieces a registration's `build` hands the resolver: the source
 * (raw-row producer), the already-decoded `PipelineConfig`, and the optional
 * enrich override (home injects one for its non-`ActiveRow` feed rows; watchlist
 * omits it and the default `ActiveRow` fan-out runs). The resolver feeds these
 * straight into `media.listRows` (design §A3).
 *
 * `SP` is the SOURCE param type, which is not always the wire param the
 * resolver parsed: `build` maps the wire shape onto the source's internal one
 * (e.g. `watchlist-items` parses `WatchlistItemsParams` but builds an
 * `ItemsParams` source; `watchlist-tonight` parses `{}` but builds a `void`
 * source). `source` + `cfg` therefore share `SP`, decoupled from the
 * registration's wire `P`.
 */
export interface BuiltMediaSource<SP, Row> {
  source: MediaSource<SP, Row>;
  cfg: PipelineConfig<SP>;
  enrichRows?: EnrichRowsFn<Row>;
}

/**
 * The adapter-visible contract a consumer module surfaces so the `/api/media`
 * resolver can dispatch one generic read endpoint across every source (design
 * §A4). Each consumer (`home`, `watchlist`) exposes a map of these through its
 * barrel; the adapter composes them into one registry WITHOUT `media` ever
 * importing a concrete source (invariant V.RG1) and WITHOUT any composition
 * logic moving between modules (invariant V.A1 — the wiring stays in the owning
 * module, this only re-packages it).
 *
 * The interface deliberately mirrors the per-source variation the hand-written
 * endpoints encode today, so the resolver stays dumb dispatch (RISK-201): rate
 * limit, param schema, cursor mode + null mapping, eligibility, and the
 * source/cfg build all ride as explicit fields.
 */
export interface MediaSourceRegistration<P = unknown, SP = P, Row = ActiveRow> {
  /** Stable wire slug from the shared tuple (design §A5). */
  sourceId: MediaSourceId;
  /**
   * Per-surface limiter the resolver applies before building (design §A7):
   * `"read"` → `watchlistReadLimiter`, `"write"` → `watchlistWriteLimiter`,
   * `undefined` → no limit (home-origin sources have none today).
   */
  rateLimit: "read" | "write" | undefined;
  /** Schema the resolver parses `c.req.query` against (invalid → 400). */
  paramSchema: ZodType<P>;
  /**
   * The source's declared/representative pagination mode. Home rows are static
   * (this equals `build(...).source.stages.cursorMode`). `watchlist-items` is
   * the one dynamic source — its mode depends on `sort`/`bucket`/`mood`, so for
   * it this field is the default (`keyset`) and the built source's
   * `stages.cursorMode` is authoritative (see `watchlistMediaSources`).
   */
  cursorMode: CursorMode;
  /**
   * How the resolver maps a `null` decode (bad/foreign/mode-mismatched cursor,
   * invariant V.CU1): home sources reject with 400, watchlist sources fall back
   * to the first page — preserving each consumer's existing behavior exactly.
   */
  cursorOnNull: "400" | "firstPage";
  /** When set, a cursor-less call is rejected (the seed rides on the cursor). */
  requiresInitialCursor?: boolean;
  /**
   * Cheap gate the resolver runs before building (home rows only). An ineligible
   * direct hit 404s, mirroring today's `composeRowPage`. Absent ⇒ always
   * eligible (watchlist sources).
   */
  eligibility?(ctx: SourceContext): Promise<boolean>;
  /**
   * Assemble the source + decoded-cursor config (+ optional enrich override)
   * for one read, mapping the wire `params` onto the source's internal shape.
   * Pure construction — it must not run `fetchRawSet`; the resolver runs
   * `listRows` over the result.
   */
  build(ctx: SourceContext, params: P, cursor: Cursor | null): BuiltMediaSource<SP, Row>;
}

/**
 * Erased element type for the heterogeneous registry. `P`/`Row` are invariant on
 * `MediaSourceRegistration` (`paramSchema`/`cfg` use them covariantly while
 * `build`/`source` use them contravariantly), so `any` is the only sound
 * erasure that lets one map hold registrations of differing param shapes —
 * mirroring how `Record<string, RowProvider>` erases each row's generics behind
 * `load`. Define each registration with its concrete `P` (type-checked at the
 * definition site), then collect into a map of this alias.
 */
export type AnyMediaSourceRegistration = MediaSourceRegistration<any, any, any>;
