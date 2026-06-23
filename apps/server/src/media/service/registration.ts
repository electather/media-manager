import type { ZodType } from "zod";
import type { ActiveRow, MediaSourceId } from "@nama/shared/media";
import type { Cursor, CursorMode } from "../cursor";
import type { MediaSource } from "../source";
import type { PipelineConfig, SourceContext } from "../types";
import type { EnrichRowsFn } from "./list-rows";

/**
 * Pipeline pieces for `media.listRows` (design §A3): source, config, optional enrich.
 * `SP` is SOURCE param type (differs from wire param); `build` maps wire→source shape.
 */
export interface BuiltMediaSource<SP, Row> {
  source: MediaSource<SP, Row>;
  cfg: PipelineConfig<SP>;
  enrichRows?: EnrichRowsFn<Row>;
}

/**
 * Adapter contract for `/api/media` dispatcher (design §A4). Mirrors per-source
 * variations so resolver stays dumb dispatch (RISK-201). Maintains V.RG1 (media
 * never imports concrete source) and V.A1 (wiring stays in owning module).
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
   * Declared pagination mode. Home rows: static, equals `build(...).source.stages.cursorMode`.
   * `watchlist-items`: dynamic (depends on `sort`/`bucket`/`mood`); this field is default
   * (`keyset`), built source's `stages.cursorMode` is authoritative.
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
   * Assemble source + config for one read, mapping wire `params` to source's internal shape.
   * Pure construction: must not call `fetchRawSet` (resolver runs `listRows` over result).
   */
  build(ctx: SourceContext, params: P, cursor: Cursor | null): BuiltMediaSource<SP, Row>;
}

/**
 * Erased element type: `P`/`Row` invariant on `MediaSourceRegistration` (covariant in
 * `paramSchema`/`cfg`, contravariant in `build`/`source`), so `any` is the only sound
 * erasure for a map of differing param shapes. Type-check at definition site, erase on collection.
 */
export type AnyMediaSourceRegistration = MediaSourceRegistration<any, any, any>;
