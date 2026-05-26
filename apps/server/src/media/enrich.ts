import type { Availability, CompactMediaItem, Facets, MatchReason } from "@ent-mcp/shared/home";
import type { MediaType } from "@ent-mcp/shared/media";
import type { ArtworkBundle, ArtworkRequestItem } from "@ent-mcp/shared/artwork";
import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";
import { keyToId, type WatchlistBucket, type WatchlistItem } from "@ent-mcp/shared/watchlist";
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
import { capabilityRegistry } from "../plugin-runtime";
import type { StatusBatchMemo } from "./status-batch";

export interface MediaEnrichRow {
  tmdbId: string;
  mediaType: MediaType;
  addedAt: number;
  source: WatchlistItem["addedSource"];
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
  items: WatchlistItem[];
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
   * When set, the server pre-classifies each row using metadata + status +
   * cached matching-server lookups and drops rows whose bucket does not
   * match. The artwork hydration round-trip then runs on the smaller set —
   * matches the v2 "skip enrichment for buckets the user is not viewing"
   * goal in #420.
   */
  filter?: WatchlistBucket;
  /**
   * Catalog metadata already fetched by the caller (e.g. `filterByMood`
   * resolved it to evaluate the mood predicate). When supplied, enrich
   * skips its own `getMetadataBatch` round-trip and seeds the cold-fill
   * loop from this map so callers don't pay for two fetches per hop.
   */
  prefetchedMetadata?: Record<string, CanonicalMetadata>;
  /**
   * Status + metadata + progress already loaded by the shared `batchLoad`
   * fan-out (design §C). Supplied by the `listRows` pipeline so enrich consumes
   * the single fan-out instead of re-issuing its own status/metadata/progress
   * round-trips; cold-fill, matching-server probes, and artwork still run. The
   * batch's own `partial` is folded in by the pipeline, so the progress leg is
   * treated as complete here.
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
export async function enrich<Row extends MediaEnrichRow>(
  rows: Row[],
  ctx: MediaEnrichContext,
  opts: EnrichOptions = {},
): Promise<EnrichResult<Row>> {
  if (rows.length === 0) return { items: [], sources: [], partial: false };

  let partial = false;
  const compositeIds = rows.map((r) => keyToId({ tmdbId: r.tmdbId, mediaType: r.mediaType }));
  const metadataKeys = rows.map((r) => ({ tmdbId: r.tmdbId, type: r.mediaType }));

  // The `listRows` pipeline pre-loads status + metadata + progress through the
  // shared `batchLoad` fan-out (design §C) and threads it in as
  // `prefetchedBatch`; consuming it keeps the read to a single fan-out rather
  // than re-issuing the three round-trips. Direct callers omit it and enrich
  // fetches them itself; `prefetchedMetadata` stays the narrower metadata-only
  // seed used by the mood path.
  const statuses = opts.prefetchedBatch
    ? opts.prefetchedBatch.statuses
    : await ctx.mediaService.getStatusBatch(compositeIds).catch((err) => {
        ctx.log.warn("[media:enrich] getStatusBatch failed", err);
        partial = true;
        return {} as Record<string, string>;
      });

  const metadata: Record<string, CanonicalMetadata> = opts.prefetchedBatch
    ? { ...opts.prefetchedBatch.metadata }
    : opts.prefetchedMetadata
      ? { ...opts.prefetchedMetadata }
      : await ctx.catalog.getMetadataBatch(metadataKeys).catch((err) => {
          ctx.log.warn("[media:enrich] getMetadataBatch failed", err);
          partial = true;
          return {} as Record<string, CanonicalMetadata>;
        });

  const progress: MediaProgressSnapshot = opts.prefetchedBatch
    ? { map: opts.prefetchedBatch.progress, partial: false }
    : await ctx.loadProgressMap(ctx);
  if (progress.partial) partial = true;

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
  const sources: Row[] = [];
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
