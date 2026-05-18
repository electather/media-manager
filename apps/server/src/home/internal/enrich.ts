import type { Availability, CompactMediaItem, Facets, MatchReason } from "@ent-mcp/shared/home";
import type { ArtworkBundle, ArtworkRequestItem } from "@ent-mcp/shared/artwork";
import type { CanonicalMetadata } from "@ent-mcp/shared/catalog";
import { capabilityRegistry } from "../../plugin-runtime";
import { ArtworkService } from "../../artwork";
import { pickMatchReason } from "./match-reason";
import type { InternalCompactMediaItem, RowContext } from "./types";

type Status = "available" | "requested" | "processing" | "unavailable" | "unknown";

/**
 * Per-item enrichment pass shared by `composeRow`. Hangs availability,
 * facets, status, and match-reason onto the lean wire-shape items the row
 * pipeline emits. The internal `__topContributors` / `__addedAtMs` fields
 * are stripped here so the response stays clean.
 *
 * Heavy fan-outs are coalesced upstream: `statusBatch` collapses every
 * item's status lookup into a single `mediaRequest@v1.getStatusBatch` call,
 * `getMatchingServers` is per-request memoized inside `MediaService`, and
 * the catalog batch read uses the composite PK index.
 */
// fallow-ignore-next-line complexity
export async function enrichItems(
  items: InternalCompactMediaItem[],
  ctx: RowContext,
  opts: { rowId: string },
): Promise<CompactMediaItem[]> {
  if (items.length === 0) return [];
  const compositeIds = items.map((i) => `${i.mediaType}:${i.tmdbId}`);
  const statuses = await ctx.statusBatch.get(compositeIds);
  const metadataKeys = items.map((i) => ({ tmdbId: i.tmdbId, type: i.mediaType }));
  const metadata = await ctx.catalog.getMetadataBatch(metadataKeys);
  const artwork = await hydrateArtwork(items, metadata, ctx);
  // The home wire requires composite ids on `availability.servers` chips,
  // so route through the registered `mediaRequest@v1` providers (the
  // canonical name; the spec's "requests" label collapses to this).
  const requestProviders = capabilityRegistry.listProviders("mediaRequest", "v1", "user");
  const enriched = await Promise.all(
    items.map(async (item) => {
      const composite = `${item.mediaType}:${item.tmdbId}`;
      const status = statuses[composite] ?? "unknown";
      const meta = metadata[composite] as CanonicalMetadata | undefined;
      const availability = await deriveAvailability(item, status, requestProviders, ctx);
      const facets = deriveFacets(meta, item);
      const matchReason = pickMatchReason(opts.rowId, item, ctx);
      const bundle = artwork[composite];
      const withArt = mergeArtwork(item, meta, bundle);
      return projectItem(withArt, { status, availability, facets, matchReason });
    }),
  );
  return enriched;
}

/**
 * Dispatches `artwork@v1.getArtwork` for items whose canonical row is missing
 * any of `posterUrl` / `backdropUrl` / `clearLogoUrl`. The artwork service
 * already patches `canonical_metadata` via `patchArtwork`, so the next read
 * sees the resolved URLs without us re-issuing the dispatch. Failures are
 * swallowed — artwork is best-effort and must never break a row response.
 */
async function hydrateArtwork(
  items: InternalCompactMediaItem[],
  metadata: Record<string, CanonicalMetadata>,
  ctx: RowContext,
): Promise<Record<string, ArtworkBundle>> {
  const requests: ArtworkRequestItem[] = [];
  for (const item of items) {
    const composite = `${item.mediaType}:${item.tmdbId}`;
    const meta = metadata[composite];
    if (meta?.posterUrl && meta.backdropUrl && meta.clearLogoUrl) continue;
    requests.push({ key: composite, ids: { tmdb: item.tmdbId }, type: item.mediaType });
  }
  if (requests.length === 0) return {};
  try {
    const service = new ArtworkService(ctx.userId, ctx.catalog);
    const res = await service.getArtwork(requests);
    return res.results;
  } catch (err) {
    ctx.logger.warn("[home:enrich] artwork hydration failed", err);
    return {};
  }
}

/**
 * Layers any resolved artwork onto an item without clobbering URLs already
 * populated upstream. Fallback order per field: existing value → fresh bundle
 * → canonical metadata. Adapters like `fromContinueWatchingEntry` ship the
 * item without poster/backdrop/clearLogo, so we must apply the catalog meta
 * here even when `hydrateArtwork` skipped a request because canonical art was
 * already complete (otherwise hero + CW rows render with null images).
 */
function pickArtworkUrl(...candidates: Array<string | null | undefined>): string | undefined {
  for (const value of candidates) if (value) return value;
  return undefined;
}

function mergeArtwork(
  item: InternalCompactMediaItem,
  meta: CanonicalMetadata | undefined,
  bundle: ArtworkBundle | undefined,
): InternalCompactMediaItem {
  return {
    ...item,
    poster: pickArtworkUrl(item.poster, bundle?.poster[0]?.url, meta?.posterUrl),
    backdrop: pickArtworkUrl(item.backdrop, bundle?.backdrop[0]?.url, meta?.backdropUrl),
    clearLogo: pickArtworkUrl(item.clearLogo, bundle?.clearLogo[0]?.url, meta?.clearLogoUrl),
  };
}

async function deriveAvailability(
  item: InternalCompactMediaItem,
  status: Status,
  requestProviders: readonly string[],
  ctx: RowContext,
): Promise<Availability> {
  // The presence of a server copy is the truth from `libraryAvailability@v1`
  // — `mediaRequest@v1.getStatusBatch` only knows titles that flowed through
  // the request flow (Seerr), so a show added to Jellyfin directly would
  // surface here as `status: "unknown"` while still being playable. Drive
  // `hasAnyServerCopy` off the matching-servers probe so directly-added
  // titles render the right CTA.
  const servers = await ctx.mediaService
    .getMatchingServers(item.tmdbId, item.mediaType)
    .catch(() => []);
  const hasAnyServerCopy = servers.length > 0;
  const requestEligible =
    !hasAnyServerCopy && status !== "available" && requestProviders.length > 0;
  return { hasAnyServerCopy, requestEligible, servers };
}

// fallow-ignore-next-line complexity
function deriveFacets(
  meta: CanonicalMetadata | undefined,
  item: InternalCompactMediaItem,
): Facets | undefined {
  const out: Facets = {};
  if (meta?.runtimeMinutes != null) out.runtimeMin = meta.runtimeMinutes;
  if (item.mediaType === "tv") {
    const features = meta?.features as { episodeCount?: number } | null | undefined;
    if (features?.episodeCount != null) out.episodeCount = features.episodeCount;
  }
  if (meta?.year != null) out.releaseDate = String(meta.year);
  // Preserve any row-supplied facets (release year falls back to the row
  // adapter when no canonical row exists yet).
  const merged: Facets = { ...item.facets, ...out };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

// fallow-ignore-next-line complexity
function projectItem(
  item: InternalCompactMediaItem,
  add: {
    status: Status;
    availability: Availability;
    facets: Facets | undefined;
    matchReason: MatchReason | null;
  },
): CompactMediaItem {
  const { __topContributors: _t, __addedAtMs: _a, ...rest } = item;
  const wire: CompactMediaItem = { ...rest, status: add.status, availability: add.availability };
  if (add.facets) wire.facets = add.facets;
  if (add.matchReason) wire.matchReason = add.matchReason;
  return wire;
}
