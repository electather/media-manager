import { libraryLensQuerySchema, type LibraryLensQueryParsed } from "@ent-mcp/shared/library";
import type { AnyMediaSourceRegistration, MediaSourceRegistration } from "../../media";
import type { LensFilters } from "../repo";
import { azSource, type AzParams } from "../sources/az";
import { timelineSource, type TimelineParams } from "../sources/timeline";
import { serverSource, type ServerParams } from "../sources/server";
import { qualitySource, type QualityParams } from "../sources/quality";
import type { ExpandedLibraryRow, LibraryRow } from "../types";
import { asLibraryReadContext } from "./context";
import { buildEnrichRows } from "./enrich";

/**
 * Surfaces the library item lenses as `MediaSourceRegistration`s so the
 * `/api/media/sources/:sourceId` resolver composes them into the one registry
 * alongside `homeMediaSources` / `watchlistMediaSources` (design §The 5 lenses:
 * "Register in media unified REGISTRY … zero new read-routing"). Mirrors
 * `watchlistMediaSources` exactly: every lens is `rateLimit: "read"` (the shared
 * read limiter), `cursorMode: "keyset"`, and `cursorOnNull: "firstPage"` (a
 * bad/foreign cursor falls back to the first page, never 400 — matching the
 * keyset codec's total decode).
 *
 * Each `build` maps the parsed wire query onto the source's internal params,
 * decodes nothing (the source's keyset codec parses the seed payload out of the
 * outer cursor the resolver already decoded), and wires the library enrich
 * override so the pipeline reads the denormalized columns instead of re-probing
 * availability (design §Enrich).
 */
const azRegistration: MediaSourceRegistration<LibraryLensQueryParsed, AzParams, LibraryRow> = {
  sourceId: "library-az",
  rateLimit: "read",
  paramSchema: libraryLensQuerySchema,
  cursorMode: "keyset",
  cursorOnNull: "firstPage",
  build: (ctx, params, cursor) => ({
    source: azSource,
    cfg: { params: toLensParams(params), cursor, limit: params.limit },
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
    cfg: { params: toLensParams(params), cursor, limit: params.limit },
    enrichRows: buildEnrichRows(asLibraryReadContext(ctx)),
  }),
};

/**
 * The Server lens registration (design §The 5 lenses, json_each). Identical
 * surface to the flat lenses, but its `Row` is `ExpandedLibraryRow`: the source
 * emits one row per `(title, server)` and the SAME `buildEnrichRows` override
 * (dedup-free) maps each expanded row to its own `CompactMediaItem`, surfacing
 * the server section — so a title repeats across server sections (intended).
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
    cfg: { params: toLensParams(params), cursor, limit: params.limit },
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
    cfg: { params: toLensParams(params), cursor, limit: params.limit },
    enrichRows: buildEnrichRows(asLibraryReadContext(ctx)),
  }),
};

/**
 * Projects the parsed wire query onto the `{ filters, limit }` shape the lens
 * sources read. All four lenses share the param shape, so one mapper serves
 * them. An omitted axis stays undefined → the repo applies no filter for it.
 */
function toLensParams(params: LibraryLensQueryParsed): { filters: LensFilters; limit: number } {
  const filters: LensFilters = {};
  if (params.kinds) filters.kinds = params.kinds;
  if (params.genres) filters.genres = params.genres;
  if (params.qualities) filters.qualities = params.qualities;
  if (params.servers) filters.servers = params.servers;
  if (params.watched) filters.watched = params.watched;
  return { filters, limit: params.limit };
}

/**
 * Registration map keyed by `sourceId`, one per library item lens. The flat
 * lenses (az/timeline) emit one row per title; the `json_each` lenses
 * (server/quality) expand each title once per section, so the same title can
 * appear multiple times in one page (intended — design §Enrich dup rules).
 */
export const libraryMediaSources: Record<string, AnyMediaSourceRegistration> = {
  "library-az": azRegistration,
  "library-timeline": timelineRegistration,
  "library-server": serverRegistration,
  "library-quality": qualityRegistration,
};
