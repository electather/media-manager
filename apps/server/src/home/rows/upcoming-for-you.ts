import type { CanonicalMetadata } from "../../catalog/types";
import { extractTmdbId, fromCanonicalMetadata } from "../adapters";
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
  // fallow-ignore-next-line complexity
  async fetchPage(ctx) {
    const res = await ctx.mediaService.getUpcomingFeed({ deadlineMs: ctx.deadlineMs });
    // The calendar plugin emits one entry per upcoming episode, so a show with
    // several queued episodes returns N hits sharing the same `tmdbId`. The
    // row renders one card per show — collapse to the earliest hit per show
    // so React keys (`${type}:${tmdbId}`) stay unique downstream.
    const hits = dedupeByMedia(
      (res.items as unknown[]).map(toUpcomingHit).filter((h): h is UpcomingHit => h !== null),
    ).slice(0, PAGE_SIZE);
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

function dedupeByMedia(hits: UpcomingHit[]): UpcomingHit[] {
  const seen = new Set<string>();
  const out: UpcomingHit[] = [];
  for (const hit of hits) {
    const key = `${hit.type}:${hit.tmdbId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

// fallow-ignore-next-line complexity
function toUpcomingHit(value: unknown): UpcomingHit | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const itemRaw = (v.item ?? v) as Record<string, unknown>;
  const tmdbId = extractTmdbId(itemRaw);
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
