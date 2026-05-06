import type { CanonicalMetadata } from "../../catalog/types";
import { extractTmdbId, fromCanonicalMetadata } from "../adapters";
import type { InternalCompactMediaItem, RowProvider } from "../types";

const PAGE_SIZE = 12;

interface WatchlistKey {
  tmdbId: string;
  type: "movie" | "tv";
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
    // `mediaRequest@v1.getStatusBatch` keys on composite ids (`movie:550`).
    const compositeIds = keys.map((k) => `${k.type}:${k.tmdbId}`);
    const statuses = await ctx.statusBatch.get(compositeIds);
    const available = keys.filter((k) => statuses[`${k.type}:${k.tmdbId}`] === "available");
    const slice = available.slice(0, PAGE_SIZE);
    const metadata = await ctx.catalog.getMetadataBatch(
      slice.map((k) => ({ tmdbId: k.tmdbId, type: k.type })),
    );
    const items: InternalCompactMediaItem[] = [];
    for (const k of slice) {
      const meta = metadata[`${k.type}:${k.tmdbId}`] as CanonicalMetadata | undefined;
      if (meta) items.push(fromCanonicalMetadata(meta));
    }
    return { items, cursor: null, partial: res.partial };
  },
};

function toWatchlistKey(value: unknown): WatchlistKey | null {
  const tmdbId = extractTmdbId(value);
  if (!tmdbId) return null;
  const t = (value as { type?: string }).type;
  const type: "movie" | "tv" = t === "movie" ? "movie" : "tv";
  return { tmdbId, type };
}

export default provider;
