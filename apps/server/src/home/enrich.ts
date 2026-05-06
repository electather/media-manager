import type { Availability, CompactMediaItem, Facets, MatchReason } from "@ent-mcp/shared/home";
import type { CanonicalMetadata } from "../catalog/types";
import { capabilityRegistry } from "../plugin-runtime/registry";
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
      return projectItem(item, { status, availability, facets, matchReason });
    }),
  );
  return enriched;
}

async function deriveAvailability(
  item: InternalCompactMediaItem,
  status: Status,
  requestProviders: readonly string[],
  ctx: RowContext,
): Promise<Availability> {
  const hasAnyServerCopy = status === "available";
  const requestEligible = status !== "available" && requestProviders.length > 0;
  const servers = hasAnyServerCopy
    ? await ctx.mediaService.getMatchingServers(item.tmdbId, item.mediaType)
    : [];
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
