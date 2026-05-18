import { uniqBy } from "es-toolkit";

import type { RowProvider } from "../internal/types";
import { loadCanonicalItems, probeMediaEntry, type MediaKey } from "./_shared";

const PAGE_SIZE = 12;

interface UpcomingHit extends MediaKey {
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
    // The calendar plugin emits one entry per upcoming episode, so a show with
    // several queued episodes returns N hits sharing the same `tmdbId`. The
    // row renders one card per show — collapse to the earliest hit per show
    // so React keys (`${type}:${tmdbId}`) stay unique downstream.
    const hits = uniqBy(
      (res.items as unknown[]).map(toUpcomingHit).filter((h): h is UpcomingHit => h !== null),
      (h) => `${h.type}:${h.tmdbId}`,
    ).slice(0, PAGE_SIZE);
    const items = await loadCanonicalItems(ctx, hits, {
      decorate: (item, hit) => {
        if (hit.episode) item.episode = hit.episode;
      },
    });
    return { items, cursor: null, partial: res.partial };
  },
};

function toUpcomingHit(value: unknown): UpcomingHit | null {
  const probe = probeMediaEntry(value);
  if (!probe) return null;
  const out: UpcomingHit = { ...probe.key };
  const episode = parseEpisodePayload(probe.itemRaw, probe.outer);
  if (episode) out.episode = episode;
  return out;
}

// fallow-ignore-next-line complexity
function parseEpisodePayload(
  itemRaw: Record<string, unknown>,
  outer: Record<string, unknown>,
): UpcomingHit["episode"] | null {
  const season = typeof itemRaw.season === "number" ? itemRaw.season : null;
  const episode = typeof itemRaw.episode === "number" ? itemRaw.episode : null;
  const airsAtRaw = outer.airsAt ?? outer.airDate;
  const airsAt = typeof airsAtRaw === "string" ? Date.parse(airsAtRaw) : Number.NaN;
  if (season === null || episode === null || Number.isNaN(airsAt)) return null;
  const name = typeof itemRaw.title === "string" ? itemRaw.title : undefined;
  return { season, episode, airsAt, ...(name ? { name } : {}) };
}

export default provider;
