import type { LibraryItem } from "@ent-mcp/plugin-sdk";
import type { CanonicalMetadata } from "../../catalog/types";
import { fromCanonicalMetadata } from "../adapters";
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
    const statuses = await ctx.statusBatch.get(keys.map((k) => k.tmdbId));
    const available = keys.filter((k) => statuses[k.tmdbId] === "available");
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

// fallow-ignore-next-line complexity
function toWatchlistKey(value: unknown): WatchlistKey | null {
  if (!value || typeof value !== "object") return null;
  const v = value as LibraryItem & Record<string, unknown>;
  const ids = v.ids as Record<string, unknown> | undefined;
  const tmdbId =
    (ids && typeof ids.tmdb === "string" && ids.tmdb) ||
    (ids && typeof ids.tmdb_id === "string" && ids.tmdb_id) ||
    (typeof v.tmdbId === "string" && v.tmdbId) ||
    null;
  if (!tmdbId) return null;
  const t = v.type;
  const type: "movie" | "tv" = t === "movie" ? "movie" : "tv";
  return { tmdbId, type };
}

export default provider;
