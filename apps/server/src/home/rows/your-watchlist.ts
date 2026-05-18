import type { RowProvider } from "../internal/types";
import { loadCanonicalItems, probeMediaEntry, type MediaKey } from "./_shared";

const PAGE_SIZE = 12;

interface WatchlistKey extends MediaKey {
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
    const items = await loadCanonicalItems(ctx, slice, {
      // Catalog cold for this title — common when a watchlist entry has not
      // been seen by any catalog-populating job yet. Render a stub from the
      // plugin-supplied title/year so the row does not silently drop server
      // copies the user clearly cares about; artwork/facets fill in once
      // the catalog populates on the next refresh.
      onMissing: (k) =>
        k.fallbackTitle
          ? {
              id: `${k.type}:${k.tmdbId}`,
              tmdbId: k.tmdbId,
              mediaType: k.type,
              title: k.fallbackTitle,
              ...(k.fallbackYear != null ? { year: k.fallbackYear } : {}),
            }
          : null,
    });
    return { items, cursor: null, partial: res.partial };
  },
};

// fallow-ignore-next-line complexity
function toWatchlistKey(value: unknown): WatchlistKey | null {
  const probe = probeMediaEntry(value);
  if (!probe) return null;
  const { key, itemRaw } = probe;
  const out: WatchlistKey = { ...key };
  if (typeof itemRaw.title === "string" && itemRaw.title.length > 0) {
    out.fallbackTitle = itemRaw.title;
  }
  if (typeof itemRaw.year === "number" && Number.isFinite(itemRaw.year)) {
    out.fallbackYear = itemRaw.year;
  }
  return out;
}

export default provider;
