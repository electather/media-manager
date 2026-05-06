import type { CanonicalMetadata } from "../../catalog/types";
import { extractTmdbId, fromCanonicalMetadata } from "../adapters";
import type { InternalCompactMediaItem, RowProvider } from "../types";

const PAGE_SIZE = 12;

interface WatchlistKey {
  tmdbId: string;
  type: "movie" | "tv";
  /** Plugin-supplied fallback title used when the catalog has no canonical row yet. */
  fallbackTitle?: string;
  fallbackYear?: number;
}

/**
 * Watchlist titles the user can already play (status === "available"). The
 * row tags items the request flow can act on; everything else is filtered
 * out so the chip strip doesn't lie about availability.
 */
const provider: RowProvider = {
  rowId: "yourWatchlist",
  kind: "yourWatchlist",
  titleKey: "home_row_yourWatchlist_header",
  async eligibility(ctx) {
    return ctx.mediaService.hasCapabilityProvider("watchlist", "v1", "user");
  },
  async initialCursor() {
    return null;
  },
  async fetchPage(ctx) {
    const res = await ctx.mediaService.getWatchlistFeed({ deadlineMs: ctx.deadlineMs });
    const keys = (res.items as unknown[])
      .map(toWatchlistKey)
      .filter((k): k is WatchlistKey => k !== null);
    if (keys.length === 0) return { items: [], cursor: null, partial: res.partial };
    // Filter to titles the user actually has on a connected library server.
    // `mediaRequest@v1.getStatusBatch` only flags items that flowed through
    // the request pipeline (Seerr) — a watchlist title added directly to
    // Jellyfin shows up here as `unknown`, so the row would silently drop
    // it. `getMatchingServers` walks `libraryAvailability@v1` providers,
    // which is the actual presence signal, and is per-request memoized.
    const present = await Promise.all(
      keys.map(async (k) => {
        const servers = await ctx.mediaService.getMatchingServers(k.tmdbId, k.type).catch(() => []);
        return servers.length > 0 ? k : null;
      }),
    );
    const available = present.filter((k): k is WatchlistKey => k !== null);
    const slice = available.slice(0, PAGE_SIZE);
    const metadata = await ctx.catalog.getMetadataBatch(
      slice.map((k) => ({ tmdbId: k.tmdbId, type: k.type })),
    );
    const items: InternalCompactMediaItem[] = [];
    for (const k of slice) {
      const meta = metadata[`${k.type}:${k.tmdbId}`] as CanonicalMetadata | undefined;
      if (meta) {
        items.push(fromCanonicalMetadata(meta));
        continue;
      }
      // Catalog cold for this title — common when a watchlist entry has not
      // been seen by any catalog-populating job yet. Render a stub from the
      // plugin-supplied title/year so the row does not silently drop server
      // copies the user clearly cares about; artwork/facets fill in once
      // the catalog populates on the next refresh.
      if (k.fallbackTitle) {
        items.push({
          id: `${k.type}:${k.tmdbId}`,
          tmdbId: k.tmdbId,
          mediaType: k.type,
          title: k.fallbackTitle,
          ...(k.fallbackYear != null ? { year: k.fallbackYear } : {}),
        });
      }
    }
    return { items, cursor: null, partial: res.partial };
  },
};

function toWatchlistKey(value: unknown): WatchlistKey | null {
  // Trakt + most watchlist providers wrap entries as `{ item: {...}, addedAt }`,
  // so the tmdb id lives on `value.item.ids`. Unwrap before probing.
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const itemRaw = (v.item ?? v) as Record<string, unknown>;
  const tmdbId = extractTmdbId(itemRaw);
  if (!tmdbId) return null;
  const t = itemRaw.type;
  const type: "movie" | "tv" = t === "movie" ? "movie" : "tv";
  const out: WatchlistKey = { tmdbId, type };
  if (typeof itemRaw.title === "string" && itemRaw.title.length > 0) {
    out.fallbackTitle = itemRaw.title;
  }
  if (typeof itemRaw.year === "number" && Number.isFinite(itemRaw.year)) {
    out.fallbackYear = itemRaw.year;
  }
  return out;
}

export default provider;
