import type { Availability, CompactMediaItem, Facets, MatchReason } from "@nama/shared/home";
import type { MediaType, RowSource } from "@nama/shared/media";
import type { ArtworkBundle, ArtworkRequestItem } from "@nama/shared/artwork";
import type { CanonicalMetadata } from "@nama/shared/catalog";
import { keyToId, type WatchlistBucket } from "@nama/shared/watchlist";
import type { CatalogService } from "../catalog";
import type {
  GetArtworkFn,
  MatchingServer,
  MediaEnrichService,
  MediaProgressContext,
  MediaProgressService,
  ToCanonicalRowFn,
} from "./types";
import { getMatchingServersCached } from "./availability-cache";
import { classifyBucket, previewForClassify, type ProgressMap } from "./classify";
import { buildFacets } from "./internal/facets";
import { batchLoad } from "./pipeline/batch-load";
import { capabilityRegistry } from "../plugin-runtime";
import type { StatusBatchMemo } from "./status-batch";

export interface MediaEnrichRow {
  tmdbId: string;
  mediaType: MediaType;
  addedAt: number;
  source: RowSource;
}

export interface MediaProgressSnapshot {
  map: ProgressMap;
  partial: boolean;
}

export type LoadProgressMap = (ctx: MediaProgressContext) => Promise<MediaProgressSnapshot>;

export interface MediaEnrichContext extends Omit<MediaProgressContext, "mediaService"> {
  userId: string;
  mediaService: MediaEnrichService & MediaProgressService;
  catalog: CatalogService;
  loadProgressMap: LoadProgressMap;
  /** Fetches artwork bundles. Injected by callers to avoid artwork ↔ media circular dep. */
  getArtwork?: GetArtworkFn;
  /** Converts raw plugin metadata to canonical shape. Injected to avoid catalog ↔ media circular dep. */
  toCanonicalRow?: ToCanonicalRowFn;
}

export type WatchlistEnrichContext = MediaEnrichContext;

export interface EnrichResult<Row extends MediaEnrichRow = MediaEnrichRow> {
  items: CompactMediaItem[];
  /**
   * Source row for each emitted item, in the same order. The
   * paginator uses this to encode the next cursor from the row that produced
   * the last *returned* item, not the last DB-scanned row (which would skip
   * matched-but-truncated items when a filter narrows the window).
   */
  sources: Row[];
  /** True when at least one per-key lookup failed (status, availability, or cold-fill). */
  partial: boolean;
}

export interface EnrichOptions {
  /**
   * Pre-classifies rows and drops non-matching buckets before artwork hydration (v2 goal #420).
   */
  filter?: WatchlistBucket;
  /**
   * Catalog metadata already fetched by caller (e.g., `filterByMood`). Avoids double fetch; seeds cold-fill.
   */
  prefetchedMetadata?: Record<string, CanonicalMetadata>;
  /**
   * Status + metadata + progress already loaded by `batchLoad` (design §C).
   * Supplied by `listRows` pipeline to avoid re-issuing; cold-fill, matching-servers, artwork still run.
   * Batch `partial` folded by pipeline — progress treated as complete here.
   */
  prefetchedBatch?: {
    statuses: Record<string, string>;
    metadata: Record<string, CanonicalMetadata>;
    progress: ProgressMap;
  };
}

export interface CompactMediaEnrichContext extends Pick<
  MediaEnrichContext,
  "userId" | "catalog" | "deadlineMs" | "log" | "getArtwork"
> {
  /** Enrichment only needs status + availability surface — not progress. */
  mediaService: MediaEnrichService;
  /** Optional request-scoped batch loader for status lookups. */
  statusBatch?: StatusBatchMemo;
}

export interface CompactMediaEnrichOptions<Row extends CompactMediaItem = CompactMediaItem> {
  /** Adds caller-specific match-reason metadata without making media depend on that caller. */
  matchReason?: (item: Row) => MatchReason | null;
}

export interface CompactMediaEnrichResult {
  items: CompactMediaItem[];
  /** True when a batch-level enrichment dependency failed. */
  partial: boolean;
}

/**
 * Build `CompactMediaItem`s via one status batch, metadata batch, artwork dispatch, and per-row
 * matching-server probe (30s cached TTL shared across `/watchlist` page-loads).
 * When `opts.filter` set, pre-classifies and shrinks rows before artwork dispatch (most expensive call).
 */
// fallow-ignore-next-line complexity
export async function enrich<Row extends MediaEnrichRow>(
  rows: Row[],
  ctx: MediaEnrichContext,
  opts: EnrichOptions = {},
): Promise<EnrichResult<Row>> {
  if (rows.length === 0) return { items: [], sources: [], partial: false };

  let partial = false;

  // Status + metadata + progress from single `batchLoad` fan-out (design §C/§F).
  // `listRows` pre-loads via `prefetchedBatch`; direct callers run `batchLoad` themselves.
  // Either way: one fan-out, not three round-trips. `prefetchedMetadata` is mood-path-only seed.
  let statuses: Record<string, string>;
  let metadata: Record<string, CanonicalMetadata>;
  let progressMap: ProgressMap;
  if (opts.prefetchedBatch) {
    statuses = opts.prefetchedBatch.statuses;
    metadata = { ...opts.prefetchedBatch.metadata };
    progressMap = opts.prefetchedBatch.progress;
  } else {
    const batch = await batchLoad(rows, ctx);
    if (batch.partial) partial = true;
    statuses = batch.statuses;
    metadata = opts.prefetchedMetadata ? { ...opts.prefetchedMetadata } : { ...batch.metadata };
    progressMap = batch.progress;
  }

  // Cold-fill canonical metadata for any rows the catalog has not seen yet so
  // the artwork dispatch below has the freshest data to compare against and
  // the per-row mapper does not double-issue plugin calls.
  await Promise.allSettled(
    rows.map(async (row) => {
      const composite = keyToId({ tmdbId: row.tmdbId, mediaType: row.mediaType });
      if (metadata[composite]) return;
      const cold = await loadColdMetadata(row, ctx).catch((err) => {
        ctx.log.warn("[media:enrich] cold-fill metadata failed", err);
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
    // fallow-ignore-next-line code-duplication
    const kept: Row[] = [];
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
        progressMap.get(composite),
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
      enrichOne(row, statuses, metadata, artwork, liveServers[i]!, progressMap),
    ),
  );

  const items: CompactMediaItem[] = [];
  const sources: Row[] = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]!;
    if (result.status === "fulfilled") {
      if (result.value) {
        items.push(result.value.item);
        sources.push(liveRows[i]!);
        if (result.value.partial) partial = true;
      } else {
        // enrichOne dropped the row: no metadata could be resolved for its tmdb
        // id (a dead/stale mapping that would otherwise render as "Movie <id>").
        // Log which id so the broken row is diagnosable rather than silent.
        const dropped = liveRows[i]!;
        ctx.log.warn("[media:enrich] dropped row with no resolvable metadata", {
          tmdbId: dropped.tmdbId,
          mediaType: dropped.mediaType,
        });
      }
    } else {
      partial = true;
      ctx.log.warn("[media:enrich] per-row enrichment threw", result.reason);
    }
  }
  return { items, sources, partial };
}

/**
 * Enriches compact media cards with shared media signals: status,
 * availability, facets, and artwork. Callers may add match reasons through a
 * callback while keeping the fan-out and projection logic owned by media.
 */
// fallow-ignore-next-line complexity
export async function enrichCompactItems<Row extends CompactMediaItem>(
  items: Row[],
  ctx: CompactMediaEnrichContext,
  opts: CompactMediaEnrichOptions<Row> = {},
): Promise<CompactMediaEnrichResult> {
  if (items.length === 0) return { items: [], partial: false };

  let partial = false;
  const compositeIds = items.map((item) => keyToId(item));
  const metadataKeys = items.map((item) => ({ tmdbId: item.tmdbId, type: item.mediaType }));

  // fallow-ignore-next-line code-duplication
  const statuses = await loadCompactStatuses(compositeIds, ctx).catch((err) => {
    ctx.log.warn("[media:compact-enrich] getStatusBatch failed", err);
    partial = true;
    return {} as Record<string, string>;
  });
  // fallow-ignore-next-line code-duplication
  const metadata = await ctx.catalog.getMetadataBatch(metadataKeys).catch((err) => {
    ctx.log.warn("[media:compact-enrich] getMetadataBatch failed", err);
    partial = true;
    return {} as Record<string, CanonicalMetadata>;
  });
  const artwork = await hydrateArtwork(items, metadata, ctx);
  const requestProviderCount = capabilityRegistry.listProviders(
    "mediaRequest",
    "v1",
    "user",
  ).length;

  const settled = await Promise.allSettled(
    items.map(async (item) => {
      const composite = keyToId(item);
      const status = (statuses[composite] ?? "unknown") as NonNullable<CompactMediaItem["status"]>;
      const meta = metadata[composite] as CanonicalMetadata | undefined;
      const availability = await deriveCompactAvailability(item, status, requestProviderCount, ctx);
      const facets = deriveCompactFacets(meta, item);
      const withArt = mergeArtwork(item, meta, artwork[composite]);
      return projectCompactItem(withArt, {
        status,
        availability,
        facets,
        matchReason: opts.matchReason?.(item) ?? null,
      });
    }),
  );

  const out: CompactMediaItem[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      out.push(result.value);
    } else {
      partial = true;
      ctx.log.warn("[media:compact-enrich] per-item enrichment threw", result.reason);
    }
  }
  return { items: out, partial };
}

function loadCompactStatuses(
  ids: string[],
  ctx: CompactMediaEnrichContext,
): Promise<Record<string, string>> {
  const opts = { deadlineMs: ctx.deadlineMs };
  if (ctx.statusBatch) return ctx.statusBatch.get(ids, opts);
  return ctx.mediaService.getStatusBatch(ids, opts);
}

async function enrichOne(
  row: MediaEnrichRow,
  statuses: Record<string, string>,
  metadata: Record<string, CanonicalMetadata>,
  artwork: Record<string, ArtworkBundle>,
  serverProbe: PromiseSettledResult<MatchingServer[]>,
  progress: ProgressMap,
): Promise<{ item: CompactMediaItem; partial: boolean } | null> {
  const composite = keyToId({ tmdbId: row.tmdbId, mediaType: row.mediaType });
  const meta = metadata[composite];

  // No canonical metadata resolved (stale/dead TMDB id from Trakt extended-edition entries).
  // Drop instead of "Movie <id>" placeholder; row stays in `watchlist_items` to self-heal.
  if (!meta) return null;

  const serversPartial = serverProbe.status === "rejected";
  const servers: MatchingServer[] = serverProbe.status === "fulfilled" ? serverProbe.value : [];

  // `mediaRequest@v1.getStatusBatch` only knows titles that flowed through
  // the request pipeline (Seerr). A title added directly to Jellyfin / Plex
  // surfaces here as `unknown` even though it is playable, so derive
  // `status` off the library probe first and fall back to the request map.
  const rawStatus = (statuses[composite] ?? "unknown") as CompactMediaItem["status"];
  const status: CompactMediaItem["status"] = servers.length > 0 ? "available" : rawStatus;

  const base = compactFromMetadata(meta);
  const withArt = mergeArtwork(base, meta, artwork[composite]);

  const item: CompactMediaItem = {
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
 * Dispatches `artwork@v1.getArtwork` for rows missing poster/backdrop/clearLogo.
 * Failures swallowed — artwork is best-effort, must never break watchlist response.
 */
async function hydrateArtwork(
  rows: Array<Pick<MediaEnrichRow, "tmdbId" | "mediaType">>,
  metadata: Record<string, CanonicalMetadata>,
  ctx: Pick<MediaEnrichContext, "getArtwork" | "deadlineMs" | "log">,
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
  if (requests.length === 0 || !ctx.getArtwork) return {};
  try {
    const res = await ctx.getArtwork(requests, { deadlineMs: ctx.deadlineMs });
    return res.results;
  } catch (err) {
    ctx.log.warn("[media:enrich] artwork hydration failed", err);
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
  row: MediaEnrichRow,
  ctx: MediaEnrichContext,
): Promise<CanonicalMetadata | null> {
  if (!ctx.toCanonicalRow) return null;
  const raw = await ctx.mediaService.getMetadata(row.tmdbId, row.mediaType, {
    deadlineMs: ctx.deadlineMs,
  });
  if (!raw) return null;
  const canonical = ctx.toCanonicalRow({ tmdbId: row.tmdbId, type: row.mediaType }, raw);
  // Fire-and-forget the write — the next read still hits the catalog cache;
  // we don't need to await it before threading the value back to the caller.
  void ctx.catalog
    .writeMetadata([canonical])
    .catch((err) => ctx.log.warn("[media:enrich] catalog write threw", err));
  return canonical;
}

async function deriveCompactAvailability(
  item: CompactMediaItem,
  status: NonNullable<CompactMediaItem["status"]>,
  requestProviderCount: number,
  ctx: CompactMediaEnrichContext,
): Promise<Availability> {
  const servers = await ctx.mediaService
    .getMatchingServers(item.tmdbId, item.mediaType, { deadlineMs: ctx.deadlineMs })
    .catch((err) => {
      ctx.log.warn("[media:compact-enrich] getMatchingServers failed", err);
      return [] as MatchingServer[];
    });
  const hasAnyServerCopy = servers.length > 0;
  const requestEligible = !hasAnyServerCopy && status !== "available" && requestProviderCount > 0;
  return { hasAnyServerCopy, requestEligible, servers };
}

// fallow-ignore-next-line complexity
function deriveCompactFacets(
  meta: CanonicalMetadata | undefined,
  item: CompactMediaItem,
): Facets | undefined {
  const out: Facets = {};
  if (meta?.runtimeMinutes != null) out.runtimeMin = meta.runtimeMinutes;
  if (item.mediaType === "tv") {
    const features = meta?.features as { episodeCount?: number } | null | undefined;
    if (features?.episodeCount != null) out.episodeCount = features.episodeCount;
  }
  if (meta?.year != null && meta.year > new Date().getUTCFullYear())
    out.releaseDate = String(meta.year);
  const merged: Facets = { ...item.facets, ...out };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

type PrivateCompactFields = {
  __topContributors?: unknown;
  __addedAtMs?: unknown;
};

function projectCompactItem(
  item: CompactMediaItem,
  add: {
    status: NonNullable<CompactMediaItem["status"]>;
    availability: Availability;
    facets: Facets | undefined;
    matchReason: MatchReason | null;
  },
): CompactMediaItem {
  const {
    __topContributors: _topContributors,
    __addedAtMs: _addedAtMs,
    ...rest
  } = item as CompactMediaItem & PrivateCompactFields;
  const wire: CompactMediaItem = { ...rest, status: add.status, availability: add.availability };
  if (add.facets) wire.facets = add.facets;
  if (add.matchReason) wire.matchReason = add.matchReason;
  return wire;
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
  const facets = buildFacets(meta);
  if (Object.keys(facets).length > 0) item.facets = facets;
  return item;
}
