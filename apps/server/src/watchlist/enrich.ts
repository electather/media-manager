import type { ConsolaInstance } from "consola";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import type { MediaType } from "@ent-mcp/shared/media";
import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";
import { keyToId, type WatchlistItem } from "@ent-mcp/shared/watchlist";
import { toCanonicalRow, type RawCanonicalSource } from "../catalog";
import type { CatalogService } from "../catalog";
import type { MediaService } from "../media";
import type { WatchlistRow } from "./repo";

export interface WatchlistEnrichContext {
  userId: string;
  mediaService: MediaService;
  catalog: CatalogService;
  log: ConsolaInstance;
}

export interface EnrichResult {
  items: WatchlistItem[];
  /** True when at least one per-key lookup failed (status, availability, or cold-fill). */
  partial: boolean;
}

/**
 * Build wire-shape `WatchlistItem`s for `rows`. Single status-batch call,
 * one catalog metadata-batch call, per-key matching-server probe (already
 * memoized inside MediaService), and a cold-fill via `getMetadata` when the
 * catalog has no row yet.
 */
// fallow-ignore-next-line complexity
export async function enrich(
  rows: WatchlistRow[],
  ctx: WatchlistEnrichContext,
): Promise<EnrichResult> {
  if (rows.length === 0) return { items: [], partial: false };

  let partial = false;
  const compositeIds = rows.map((r) => keyToId({ tmdbId: r.tmdbId, mediaType: r.mediaType }));
  const metadataKeys = rows.map((r) => ({ tmdbId: r.tmdbId, type: r.mediaType }));

  const statuses = await ctx.mediaService.getStatusBatch(compositeIds).catch((err) => {
    ctx.log.warn("[watchlist:enrich] getStatusBatch failed", err);
    partial = true;
    return {} as Record<string, string>;
  });

  const metadata = await ctx.catalog.getMetadataBatch(metadataKeys).catch((err) => {
    ctx.log.warn("[watchlist:enrich] getMetadataBatch failed", err);
    partial = true;
    return {} as Record<string, CanonicalMetadata>;
  });

  const settled = await Promise.allSettled(
    rows.map((row) => enrichOne(row, statuses, metadata, ctx)),
  );

  const items: WatchlistItem[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      if (result.value) items.push(result.value);
    } else {
      partial = true;
      ctx.log.warn("[watchlist:enrich] per-row enrichment threw", result.reason);
    }
  }
  return { items, partial };
}

async function enrichOne(
  row: WatchlistRow,
  statuses: Record<string, string>,
  metadata: Record<string, CanonicalMetadata>,
  ctx: WatchlistEnrichContext,
): Promise<WatchlistItem | null> {
  const composite = keyToId({ tmdbId: row.tmdbId, mediaType: row.mediaType });
  let meta = metadata[composite];

  if (!meta) {
    const cold = await loadColdMetadata(row, ctx).catch((err) => {
      ctx.log.warn("[watchlist:enrich] cold-fill metadata failed", err);
      return null;
    });
    if (cold) meta = cold;
  }

  const servers = await ctx.mediaService
    .getMatchingServers(row.tmdbId, row.mediaType)
    .catch((err) => {
      ctx.log.warn("[watchlist:enrich] getMatchingServers failed", err);
      return [] as Awaited<ReturnType<MediaService["getMatchingServers"]>>;
    });

  const status = (statuses[composite] ?? "unknown") as CompactMediaItem["status"];
  const base = meta ? compactFromMetadata(meta) : minimalCompact(row.tmdbId, row.mediaType);

  const item: WatchlistItem = {
    ...base,
    addedAt: row.addedAt,
    addedSource: row.source,
  };
  if (status) item.status = status;
  if (servers.length > 0) {
    item.availability = {
      hasAnyServerCopy: true,
      requestEligible: true,
      servers: servers.map((s) => ({ id: s.id, label: s.label })),
    };
  }
  return item;
}

async function loadColdMetadata(
  row: WatchlistRow,
  ctx: WatchlistEnrichContext,
): Promise<CanonicalMetadata | null> {
  const raw = (await ctx.mediaService.getMetadata(
    row.tmdbId,
    row.mediaType,
  )) as RawCanonicalSource | null;
  if (!raw) return null;
  await ctx.catalog.writeMetadata([
    toCanonicalRow({ tmdbId: row.tmdbId, type: row.mediaType }, raw),
  ]);
  return ctx.catalog.getMetadata(row.tmdbId, row.mediaType);
}

function compactFromMetadata(meta: CanonicalMetadata): CompactMediaItem {
  const item: CompactMediaItem = {
    id: keyToId({ tmdbId: meta.tmdbId, mediaType: meta.mediaType }),
    tmdbId: meta.tmdbId,
    mediaType: meta.mediaType,
    title: meta.title,
  };
  if (meta.year != null) item.year = meta.year;
  if (meta.posterUrl) item.poster = meta.posterUrl;
  if (meta.backdropUrl) item.backdrop = meta.backdropUrl;
  if (meta.clearLogoUrl) item.clearLogo = meta.clearLogoUrl;
  if (meta.overview) item.overview = meta.overview;
  if (meta.genres && meta.genres.length > 0) item.genres = meta.genres.slice(0, 3);
  if (meta.runtimeMinutes != null || meta.year != null) {
    const facets: NonNullable<CompactMediaItem["facets"]> = {};
    if (meta.runtimeMinutes != null) facets.runtimeMin = meta.runtimeMinutes;
    if (meta.year != null) facets.releaseDate = String(meta.year);
    item.facets = facets;
  }
  return item;
}

function minimalCompact(tmdbId: string, mediaType: MediaType): CompactMediaItem {
  return {
    id: keyToId({ tmdbId, mediaType }),
    tmdbId,
    mediaType,
    title: `${mediaType === "tv" ? "Show" : "Movie"} ${tmdbId}`,
  };
}
