import { libraryLensQuerySchema, type LibraryLensQueryParsed } from "@nama/shared/library";
import type { AnyMediaSourceRegistration, MediaSourceRegistration } from "../../media";
import { azSource, type AzParams } from "../sources/az";
import { timelineSource, type TimelineParams } from "../sources/timeline";
import { serverSource, type ServerParams } from "../sources/server";
import { qualitySource, type QualityParams } from "../sources/quality";
import type { ExpandedLibraryRow, LibraryRow } from "../types";
import { asLibraryReadContext } from "./context";
import { buildEnrichRows } from "./enrich";
import { toLensFilters } from "./lens-filters";

/** Library lenses as `MediaSourceRegistration`s (design §The 5 lenses). All use `rateLimit: "read"`,
 * `cursorMode: "keyset"`, `cursorOnNull: "firstPage"` (bad/foreign cursor → first page, never 400);
 * each wires enrich override to read denormalized columns (design §Enrich).
 */
// The four lens registrations share the `MediaSourceRegistration` skeleton by
// design — each differs only in its source, params type, and Row type, so a
// factory would erase the per-lens generic parameters the resolver type-checks
// against. fallow's clone detector flags the shared shape; keep it explicit.
// fallow-ignore-next-line code-duplication
const azRegistration: MediaSourceRegistration<LibraryLensQueryParsed, AzParams, LibraryRow> = {
  sourceId: "library-az",
  rateLimit: "read",
  paramSchema: libraryLensQuerySchema,
  cursorMode: "keyset",
  cursorOnNull: "firstPage",
  build: (ctx, params, cursor) => ({
    source: azSource,
    cfg: {
      params: { filters: toLensFilters(params), limit: params.limit },
      cursor,
      limit: params.limit,
    },
    enrichRows: buildEnrichRows(asLibraryReadContext(ctx)),
  }),
};

const timelineRegistration: MediaSourceRegistration<
  LibraryLensQueryParsed,
  TimelineParams,
  LibraryRow
> = {
  sourceId: "library-timeline",
  rateLimit: "read",
  paramSchema: libraryLensQuerySchema,
  cursorMode: "keyset",
  cursorOnNull: "firstPage",
  build: (ctx, params, cursor) => ({
    source: timelineSource,
    cfg: {
      params: { filters: toLensFilters(params), limit: params.limit },
      cursor,
      limit: params.limit,
    },
    enrichRows: buildEnrichRows(asLibraryReadContext(ctx)),
  }),
};

/**
 * Server lens registration (design §The 5 lenses, json_each). Emits one row per
 * `(title, server)` with dedup-free enrich so a title repeats across sections (intended).
 */
const serverRegistration: MediaSourceRegistration<
  LibraryLensQueryParsed,
  ServerParams,
  ExpandedLibraryRow
> = {
  sourceId: "library-server",
  rateLimit: "read",
  paramSchema: libraryLensQuerySchema,
  cursorMode: "keyset",
  cursorOnNull: "firstPage",
  build: (ctx, params, cursor) => ({
    source: serverSource,
    cfg: {
      params: { filters: toLensFilters(params), limit: params.limit },
      cursor,
      limit: params.limit,
    },
    enrichRows: buildEnrichRows(asLibraryReadContext(ctx)),
  }),
};

/**
 * The Quality lens registration (design §The 5 lenses, json_each). Mirrors the
 * Server registration: `ExpandedLibraryRow` rows, the dedup-free enrich, a title
 * repeating once per quality tier section (intended).
 */
const qualityRegistration: MediaSourceRegistration<
  LibraryLensQueryParsed,
  QualityParams,
  ExpandedLibraryRow
> = {
  sourceId: "library-quality",
  rateLimit: "read",
  paramSchema: libraryLensQuerySchema,
  cursorMode: "keyset",
  cursorOnNull: "firstPage",
  build: (ctx, params, cursor) => ({
    source: qualitySource,
    cfg: {
      params: { filters: toLensFilters(params), limit: params.limit },
      cursor,
      limit: params.limit,
    },
    enrichRows: buildEnrichRows(asLibraryReadContext(ctx)),
  }),
};

/**
 * Flat lenses (az/timeline): one row per title. `json_each` lenses
 * (server/quality): expand each title once per section (intended — design §Enrich dup rules).
 */
export const libraryMediaSources: Record<string, AnyMediaSourceRegistration> = {
  "library-az": azRegistration,
  "library-timeline": timelineRegistration,
  "library-server": serverRegistration,
  "library-quality": qualityRegistration,
};
