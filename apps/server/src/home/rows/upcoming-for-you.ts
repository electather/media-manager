import type { CanonicalMetadata } from "../../catalog/types";
import { fromCanonicalMetadata } from "../adapters";
import type { InternalCompactMediaItem, RowProvider } from "../types";

const PAGE_SIZE = 12;

interface UpcomingHit {
  tmdbId: string;
  type: "movie" | "tv";
  episode?: { season: number; episode: number; airsAt: number; name?: string };
}

/**
 * Upcoming releases tagged off the calendar plugin. Bounded — the row ships
 * a single page; calendar plugin failures propagate as `partial: true`.
 */
const provider: RowProvider = {
  rowId: "upcomingForYou",
  kind: "upcomingForYou",
  titleKey: "home_row_upcomingForYou_header",
  async eligibility(ctx) {
    return ctx.mediaService.hasCapabilityProvider("calendar", "v1", "user");
  },
  async initialCursor() {
    return null;
  },
  async fetchPage(ctx) {
    const res = await ctx.mediaService.getUpcomingFeed({ deadlineMs: ctx.deadlineMs });
    const hits = (res.items as unknown[])
      .map(toUpcomingHit)
      .filter((h): h is UpcomingHit => h !== null)
      .slice(0, PAGE_SIZE);
    if (hits.length === 0) return { items: [], cursor: null, partial: res.partial };
    const metadata = await ctx.catalog.getMetadataBatch(
      hits.map((h) => ({ tmdbId: h.tmdbId, type: h.type })),
    );
    const items: InternalCompactMediaItem[] = [];
    for (const h of hits) {
      const meta = metadata[`${h.type}:${h.tmdbId}`] as CanonicalMetadata | undefined;
      if (!meta) continue;
      const item = fromCanonicalMetadata(meta);
      if (h.episode) item.episode = h.episode;
      items.push(item);
    }
    return { items, cursor: null, partial: res.partial };
  },
};

// fallow-ignore-next-line complexity
function toUpcomingHit(value: unknown): UpcomingHit | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const itemRaw = (v.item ?? v) as Record<string, unknown>;
  const ids = itemRaw.ids as Record<string, unknown> | undefined;
  const tmdbId =
    (ids && typeof ids.tmdb === "string" && ids.tmdb) ||
    (ids && typeof ids.tmdb_id === "string" && ids.tmdb_id) ||
    (typeof itemRaw.tmdbId === "string" && itemRaw.tmdbId) ||
    null;
  if (!tmdbId) return null;
  const t = itemRaw.type;
  const type: "movie" | "tv" = t === "movie" ? "movie" : "tv";
  const out: UpcomingHit = { tmdbId, type };
  const airsAtRaw = v.airsAt ?? v.airDate;
  const season = typeof itemRaw.season === "number" ? itemRaw.season : undefined;
  const episode = typeof itemRaw.episode === "number" ? itemRaw.episode : undefined;
  const airsAt = typeof airsAtRaw === "string" ? Date.parse(airsAtRaw) : undefined;
  if (season != null && episode != null && airsAt != null && !Number.isNaN(airsAt)) {
    out.episode = {
      season,
      episode,
      airsAt,
      ...(typeof itemRaw.title === "string" ? { name: itemRaw.title } : {}),
    };
  }
  return out;
}

export default provider;
