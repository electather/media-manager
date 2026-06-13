import type { CanonicalMetadata } from "@nama/shared/catalog";
import type { CompactMediaItem } from "@nama/shared/home";
import { loadProgressMap, type EnrichRowsFn, type ProgressMap } from "../../media";
import type { ExpandedLibraryRow, LibraryRow } from "../types";
import type { ResolvedLibraryReadContext } from "./context";

/**
 * Builds the library lens `enrichRows` hook (design §Enrich). This is the custom
 * enrich path the design mandates over the default `batchLoad` + `enrich`: the
 * default re-probes availability live (`getMatchingServersCached`), which would
 * defeat the whole denormalized projection AND collapse the row set to one item
 * per `(tmdbId, mediaType)` — killing the phase-3 server/quality `json_each`
 * fan-out. Instead this reads `availability.servers` and the quality `tags`
 * straight off the row's denormalized columns and never re-probes.
 *
 * It produces exactly one `CompactMediaItem` per input row and NEVER dedups or
 * collapses on `(tmdbId, mediaType)`. Az/timeline emit one `LibraryRow` per
 * title; the phase-3 server/quality lenses expand `json_each` so the SAME title
 * appears once per server / quality section as an {@link ExpandedLibraryRow}
 * carrying its `section`. Keeping the mapping dedup-free — and surfacing the
 * per-row `section` onto the item — is what lets the FE insert a header on
 * `section.id` change down the flat stream (design §Enrich dup rules; §FE).
 *
 * Typed on `LibraryRow`; the grouped sources pass `ExpandedLibraryRow`s (a
 * subtype), so one builder serves all four lenses — the optional `section` is
 * read structurally and is simply absent on the flat lenses.
 */
export function buildEnrichRows(ctx: ResolvedLibraryReadContext): EnrichRowsFn<LibraryRow> {
  return async (rows) => {
    if (rows.length === 0) return { items: [], partial: false };
    const { metadata, partial: metaPartial } = await loadMetadata(ctx, rows);
    const { map: progress, partial: progressPartial } = await loadProgressMap(ctx);
    const items = rows.map((row) => toCompactItem(row, metadata[row.id], progress));
    return { items, partial: metaPartial || progressPartial };
  };
}

/**
 * Batches catalog metadata for the page in one read, keyed by the composite id
 * (`candidateId` = `"<type>:<tmdbId>"`, which equals `LibraryRow.id`). A
 * metadata failure degrades to an empty map + `partial: true` rather than
 * throwing, so a title with no cached metadata still renders from its
 * denormalized columns (matching the design's tolerance of null meta).
 */
async function loadMetadata(
  ctx: ResolvedLibraryReadContext,
  rows: LibraryRow[],
): Promise<{ metadata: Record<string, CanonicalMetadata>; partial: boolean }> {
  const keys = rows.map((row) => ({ tmdbId: row.tmdbId, type: row.mediaType }));
  try {
    return { metadata: await ctx.catalog.getMetadataBatch(keys), partial: false };
  } catch (err) {
    ctx.log.warn("[library:enrich] getMetadataBatch failed; enriching from denorm only", err);
    return { metadata: {}, partial: true };
  }
}

/**
 * Maps one row to its wire `CompactMediaItem`. Display fields (title, year,
 * poster, backdrop, overview, genres) come from catalog metadata when present;
 * the availability snapshot and quality `tags` come from the row's denormalized
 * columns with NO live re-probe; the within-content `progress` (the resume bar)
 * comes from the live continue-watching map. The row-level `watchedState` facet
 * is NOT a `CompactMediaItem` field — it drives the filter axis server-side, not
 * a card chip. Absent fields are omitted (not null) per the `CompactMediaItem`
 * lean-wire convention.
 */
function toCompactItem(
  row: LibraryRow & Partial<Pick<ExpandedLibraryRow, "section">>,
  meta: CanonicalMetadata | undefined,
  progress: ProgressMap,
): CompactMediaItem {
  const item: CompactMediaItem = {
    id: row.id,
    tmdbId: row.tmdbId,
    mediaType: row.mediaType,
    title: meta?.title ?? "",
    availability: {
      hasAnyServerCopy: row.servers.length > 0,
      requestEligible: false,
      servers: row.servers,
    },
  };
  // The quality tiers ride on `tags` so the FE renders a chip per tier; an
  // empty array would render an empty chip strip, so it is omitted entirely.
  if (row.qualityTiers.length > 0) item.tags = row.qualityTiers;
  const resume = progress.get(row.id);
  if (resume) item.progress = { watched: resume.watched, total: resume.total };
  // The grouped (server/quality) lenses tag each expanded row with the section
  // it belongs to; surfacing it lets the FE insert a header on section change
  // and key the list on `id + section.id`. The flat lenses leave it absent.
  if (row.section) item.section = row.section;
  applyMetadata(item, row, meta);
  return item;
}

/** Folds the catalog metadata display fields onto the item, omitting absent ones. */
function applyMetadata(
  item: CompactMediaItem,
  row: LibraryRow,
  meta: CanonicalMetadata | undefined,
): void {
  const year = meta?.year ?? row.year;
  if (year != null) item.year = year;
  if (meta?.posterUrl) item.poster = meta.posterUrl;
  if (meta?.backdropUrl) item.backdrop = meta.backdropUrl;
  if (meta?.overview) item.overview = meta.overview;
  const genres = meta?.genres ?? row.genres;
  if (genres.length > 0) item.genres = genres.slice(0, 3);
}
