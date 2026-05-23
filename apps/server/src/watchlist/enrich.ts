import type { ConsolaInstance } from "consola";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import type { MediaType } from "@ent-mcp/shared/media";
import type { ArtworkBundle, ArtworkRequestItem } from "@ent-mcp/shared/artwork";
import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";
import { keyToId, type WatchlistBucket, type WatchlistItem } from "@ent-mcp/shared/watchlist";
import { ArtworkService } from "../artwork";
import { toCanonicalRow, type RawCanonicalSource } from "../catalog";
import type { CatalogService } from "../catalog";
import type { MatchingServer, MediaService } from "../media";
import { getMatchingServersCached } from "./availability-cache";
import { classifyBucket, previewForClassify } from "./classify";
import { loadProgressMap, type ProgressMap } from "./progress";
import type { WatchlistRow } from "./repo";

export interface WatchlistEnrichContext {
  userId: string;
  mediaService: MediaService;
  catalog: CatalogService;
  log: ConsolaInstance;
  deadlineMs?: number;
}

export interface EnrichResult {
  items: WatchlistItem[];
  /**
   * Source `WatchlistRow` for each emitted item, in the same order. The
   * paginator uses this to encode the next cursor from the row that produced
   * the last *returned* item, not the last DB-scanned row (which would skip
   * matched-but-truncated items when a filter narrows the window).
   */
  sources: WatchlistRow[];
  /** True when at least one per-key lookup failed (status, availability, or cold-fill). */
  partial: boolean;
}

export interface EnrichOptions {
  /**
   * When set, the server pre-classifies each row using metadata + status +
   * cached matching-server lookups and drops rows whose bucket does not
   * match. The artwork hydration round-trip then runs on the smaller set —
   * matches the v2 "skip enrichment for buckets the user is not viewing"
   * goal in #420.
   */
  filter?: WatchlistBucket;
}

/**
 * Build wire-shape `WatchlistItem`s for `rows`. Single status-batch call,
 * one catalog metadata-batch call, one artwork dispatch for items missing
 * canonical poster/backdrop/clearLogo, and a per-row matching-server probe
 * (cross-request cached at 30 s TTL so /watchlist + /counts share the work).
 *
 * When `opts.filter` is set we pre-classify with the cheap signals and
 * shrink the row set before artwork dispatch — the most expensive call on
 * the cold path.
 */
// fallow-ignore-next-line complexity
export async function enrich(
  rows: WatchlistRow[],
  ctx: WatchlistEnrichContext,
  opts: EnrichOptions = {},
): Promise<EnrichResult> {
  if (rows.length === 0) return { items: [], sources: [], partial: false };

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

  const progress = await loadProgressMap(ctx);
  if (progress.partial) partial = true;

  // Cold-fill canonical metadata for any rows the catalog has not seen yet so
  // the artwork dispatch below has the freshest data to compare against and
  // the per-row mapper does not double-issue plugin calls.
  await Promise.allSettled(
    rows.map(async (row) => {
      const composite = keyToId({ tmdbId: row.tmdbId, mediaType: row.mediaType });
      if (metadata[composite]) return;
      const cold = await loadColdMetadata(row, ctx).catch((err) => {
        ctx.log.warn("[watchlist:enrich] cold-fill metadata failed", err);
        return null;
      });
      if (cold) metadata[composite] = cold;
    }),
  );

  // Materialize matching-servers up-front (per-key, cached). When the caller
  // asked for a `filter` we use the result to drop rows BEFORE artwork
  // hydration; when there's no filter we still hoist the call here so the
  // per-row enricher reads from the same cached value rather than racing the
  // request-scoped memo a second time.
  const servers = await Promise.allSettled(
    rows.map((row) =>
      getMatchingServersCached(ctx.userId, ctx.mediaService, row.tmdbId, row.mediaType),
    ),
  );

  let liveRows = rows;
  let liveServers = servers;
  if (opts.filter) {
    const kept: WatchlistRow[] = [];
    const keptServers: typeof servers = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const composite = keyToId({ tmdbId: row.tmdbId, mediaType: row.mediaType });
      const serverProbe = servers[i]!;
      const serversList: MatchingServer[] =
        serverProbe.status === "fulfilled" ? serverProbe.value : [];
      if (serverProbe.status === "rejected") partial = true;
      const probe = previewForClassify(
        metadata[composite],
        statuses[composite],
        serversList,
        progress.map.get(composite),
      );
      if (classifyBucket(probe) === opts.filter) {
        kept.push(row);
        keptServers.push(serverProbe);
      }
    }
    liveRows = kept;
    liveServers = keptServers;
  }

  if (liveRows.length === 0) return { items: [], sources: [], partial };

  const artwork = await hydrateArtwork(liveRows, metadata, ctx);

  const settled = await Promise.allSettled(
    liveRows.map((row, i) =>
      enrichOne(row, statuses, metadata, artwork, liveServers[i]!, progress.map),
    ),
  );

  const items: WatchlistItem[] = [];
  const sources: WatchlistRow[] = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]!;
    if (result.status === "fulfilled") {
      if (result.value) {
        items.push(result.value.item);
        sources.push(liveRows[i]!);
        if (result.value.partial) partial = true;
      }
    } else {
      partial = true;
      ctx.log.warn("[watchlist:enrich] per-row enrichment threw", result.reason);
    }
  }
  return { items, sources, partial };
}

async function enrichOne(
  row: WatchlistRow,
  statuses: Record<string, string>,
  metadata: Record<string, CanonicalMetadata>,
  artwork: Record<string, ArtworkBundle>,
  serverProbe: PromiseSettledResult<MatchingServer[]>,
  progress: ProgressMap,
): Promise<{ item: WatchlistItem; partial: boolean } | null> {
  const composite = keyToId({ tmdbId: row.tmdbId, mediaType: row.mediaType });
  const meta = metadata[composite];

  const serversPartial = serverProbe.status === "rejected";
  const servers: MatchingServer[] = serverProbe.status === "fulfilled" ? serverProbe.value : [];

  // `mediaRequest@v1.getStatusBatch` only knows titles that flowed through
  // the request pipeline (Seerr). A title added directly to Jellyfin / Plex
  // surfaces here as `unknown` even though it is playable, so derive
  // `status` off the library probe first and fall back to the request map.
  const rawStatus = (statuses[composite] ?? "unknown") as CompactMediaItem["status"];
  const status: CompactMediaItem["status"] = servers.length > 0 ? "available" : rawStatus;

  const base = meta ? compactFromMetadata(meta) : minimalCompact(row.tmdbId, row.mediaType);
  const withArt = mergeArtwork(base, meta, artwork[composite]);

  const item: WatchlistItem = {
    ...withArt,
    addedAt: row.addedAt,
    addedSource: row.source,
  };
  item.status = status;
  item.availability = {
    hasAnyServerCopy: servers.length > 0,
    requestEligible: servers.length === 0 && status !== "available",
    servers: servers.map((s) => ({ id: s.id, label: s.label })),
  };
  const resume = progress.get(composite);
  if (resume) item.progress = { watched: resume.watched, total: resume.total };
  return { item, partial: serversPartial };
}

/**
 * Dispatches `artwork@v1.getArtwork` for rows whose canonical metadata is
 * missing any of `posterUrl` / `backdropUrl` / `clearLogoUrl`. The artwork
 * service writes resolved URLs back to `canonical_metadata` so subsequent
 * reads hit the cached copy. Failures are swallowed — artwork is best-effort
 * and must never break a watchlist response.
 */
async function hydrateArtwork(
  rows: WatchlistRow[],
  metadata: Record<string, CanonicalMetadata>,
  ctx: WatchlistEnrichContext,
): Promise<Record<string, ArtworkBundle>> {
  const requests: ArtworkRequestItem[] = [];
  for (const row of rows) {
    const composite = keyToId({ tmdbId: row.tmdbId, mediaType: row.mediaType });
    const meta = metadata[composite];
    if (meta?.posterUrl && meta.backdropUrl && meta.clearLogoUrl) continue;
    requests.push({
      key: composite,
      ids: { tmdb: row.tmdbId },
      type: row.mediaType,
    });
  }
  if (requests.length === 0) return {};
  try {
    const service = new ArtworkService(ctx.userId, ctx.catalog);
    const res = await service.getArtwork(requests);
    return res.results;
  } catch (err) {
    ctx.log.warn("[watchlist:enrich] artwork hydration failed", err);
    return {};
  }
}

function pickArtworkUrl(...candidates: Array<string | null | undefined>): string | undefined {
  for (const value of candidates) if (value) return value;
  return undefined;
}

function mergeArtwork(
  item: CompactMediaItem,
  meta: CanonicalMetadata | undefined,
  bundle: ArtworkBundle | undefined,
): CompactMediaItem {
  const poster = pickArtworkUrl(item.poster, bundle?.poster[0]?.url, meta?.posterUrl);
  const backdrop = pickArtworkUrl(item.backdrop, bundle?.backdrop[0]?.url, meta?.backdropUrl);
  const clearLogo = pickArtworkUrl(item.clearLogo, bundle?.clearLogo[0]?.url, meta?.clearLogoUrl);
  const next: CompactMediaItem = { ...item };
  if (poster) next.poster = poster;
  else delete next.poster;
  if (backdrop) next.backdrop = backdrop;
  else delete next.backdrop;
  if (clearLogo) next.clearLogo = clearLogo;
  else delete next.clearLogo;
  return next;
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
  const canonical = toCanonicalRow({ tmdbId: row.tmdbId, type: row.mediaType }, raw);
  // Fire-and-forget the write — the next read still hits the catalog cache;
  // we don't need to await it before threading the value back to the caller.
  void ctx.catalog
    .writeMetadata([canonical])
    .catch((err) => ctx.log.warn("[watchlist:enrich] catalog write threw", err));
  return canonical;
}

function compactFromMetadata(meta: CanonicalMetadata): CompactMediaItem {
  const item: CompactMediaItem = {
    id: keyToId({ tmdbId: meta.tmdbId, mediaType: meta.mediaType }),
    tmdbId: meta.tmdbId,
    mediaType: meta.mediaType,
    title: meta.title,
  };
  // `overview` deliberately omitted from the list shape — the detail modal
  // rehydrates it via `home.details`. See follow-up issue #420.
  // fallow-ignore-next-line code-duplication
  if (meta.year != null) item.year = meta.year;
  if (meta.posterUrl) item.poster = meta.posterUrl;
  if (meta.backdropUrl) item.backdrop = meta.backdropUrl;
  if (meta.clearLogoUrl) item.clearLogo = meta.clearLogoUrl;
  // Ship the full genres array — client `deriveMoods` runs AND-rules across
  // multiple names; trimming here would silently break clusters that combine
  // more than the first three. The card UI clamps the visible chip count.
  if (meta.genres && meta.genres.length > 0) item.genres = meta.genres;
  const facets: NonNullable<CompactMediaItem["facets"]> = {};
  if (meta.runtimeMinutes != null) facets.runtimeMin = meta.runtimeMinutes;
  // `releaseDate` doubles as the "upcoming?" flag on the client. Only emit
  // it when the release year is in the future so already-released items
  // don't land in the upcoming bucket.
  if (meta.year != null && meta.year > new Date().getUTCFullYear()) {
    facets.releaseDate = String(meta.year);
  }
  if (Object.keys(facets).length > 0) item.facets = facets;
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
