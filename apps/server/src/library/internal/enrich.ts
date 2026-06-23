import type { CanonicalMetadata } from "@nama/shared/catalog";
import type { CompactMediaItem } from "@nama/shared/home";
import { loadProgressMap, type EnrichRowsFn, type ProgressMap } from "../../media";
import type { ExpandedLibraryRow, LibraryRow } from "../types";
import type { LibraryContext } from "../types";

// Custom enrich path (design §Enrich): reads servers + quality tags from denormalized columns instead of live re-probe,
// avoiding collapse to one per (tmdbId, mediaType) that kills json_each fan-out. Never dedups (design §Enrich dup rules; §FE)
// so FE can insert headers on section.id change. Grouped sources pass ExpandedLibraryRow (subtype with optional section).
export function buildEnrichRows(ctx: LibraryContext): EnrichRowsFn<LibraryRow> {
  return async (rows) => {
    if (rows.length === 0) return { items: [], partial: false };
    const { metadata, partial: metaPartial } = await loadMetadata(ctx, rows);
    const { map: progress, partial: progressPartial } = await loadProgressMap(ctx);
    const items = rows.map((row) => toCompactItem(row, metadata[row.id], progress));
    return { items, partial: metaPartial || progressPartial };
  };
}

// Batches catalog metadata by composite id (`candidateId` = `"<type>:<tmdbId>"` = `LibraryRow.id`).
// Metadata failure degrades to empty map + `partial: true` (not throw), so uncached titles render from denorm columns.
async function loadMetadata(
  ctx: LibraryContext,
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

// Maps row to wire `CompactMediaItem`. Display fields (title, year, poster, backdrop, overview, genres)
// from catalog metadata; availability and quality `tags` from denormalized columns (NO re-probe);
// `progress` from live continue-watching map. Row-level `watchedState` drives filter axis, not card chip.
// Absent fields omitted (not null) per `CompactMediaItem` lean-wire convention.
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
