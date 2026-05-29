import { uniqBy } from "es-toolkit";
import type { MediaSource } from "../../media";
import { probeMediaEntry, type MediaKey } from "../rows/_shared";

/** An upcoming-feed hit keyed for catalog lookup, carrying the earliest queued episode. */
export interface UpcomingHit extends MediaKey {
  episode?: { season: number; episode: number; airsAt: number; name?: string };
}

/**
 * Upcoming-feed source (design §H/§M.5). Reads the `calendar@v1` feed for the
 * `upcomingForYou` row. The calendar plugin emits one entry per upcoming
 * episode, so a show with several queued episodes returns N hits sharing the
 * same `tmdbId`; the row renders one card per show, so `fetchRawSet` collapses
 * to the earliest hit per show (`uniqBy`, feed order preserved) — that
 * dedupe is content-defining (it decides which keys exist), so it lives in the
 * source. The bounded slice + catalog projection stay home-side until US-022.
 * A calendar-plugin soft-failure rides through as `partial: true`.
 */
export const upcomingForYouSource: MediaSource<void, UpcomingHit> = {
  sourceId: "upcomingForYou",
  async fetchRawSet(ctx) {
    const res = await ctx.mediaService.getUpcomingFeed({ deadlineMs: ctx.deadlineMs });
    const rows = uniqBy(
      (res.items as unknown[]).map(toUpcomingHit).filter((h): h is UpcomingHit => h !== null),
      (h) => `${h.type}:${h.tmdbId}`,
    );
    return { rows, partial: res.partial };
  },
  // `"none"`: hits stay in feed order. Offset: the row pages by index (it ships
  // a single bounded page today, but the mode keeps it pipeline-ready).
  stages: { sort: "none", cursorMode: "offset" },
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
