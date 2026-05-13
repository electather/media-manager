import type { SeasonAvailabilityServer, SeasonInfo as WireSeasonInfo } from "@ent-mcp/shared/home";
import type { Episode, EpisodeStatus, Season } from "@/features/request-flow/lib/types";

export type DerivedSeasonStatus = "available" | "partial" | "unavailable" | "upcoming";

/**
 * Best-of-N season status across the user's connected library servers.
 *   - `available`   — at least one server holds every episode.
 *   - `partial`     — at least one server holds at least one episode.
 *   - `upcoming`    — every episode airs in the future and no server has it.
 *   - `unavailable` — every server returned zero presence (or no servers).
 */
// fallow-ignore-next-line complexity
export function deriveSeasonStatus(
  season: WireSeasonInfo,
  servers: SeasonAvailabilityServer[],
  now: number = Date.now(),
): DerivedSeasonStatus {
  const presentByServer = servers.map(
    (s) =>
      new Set(
        s.episodesPresent.filter((e) => e.season === season.seasonNumber).map((e) => e.episode),
      ),
  );
  // Prefer TMDB's announced count: for partially-aired seasons `episodes.length`
  // is just what TMDB has metadata for so far (e.g. 12 of 24 announced). A
  // server holding the 12 aired episodes would otherwise misread as "available"
  // for the whole season.
  const total = season.totalEpisodes || season.episodes.length;
  const anyAll = presentByServer.some((set) => total > 0 && set.size >= total);
  if (anyAll) return "available";
  const anyPartial = presentByServer.some((set) => set.size > 0);
  if (anyPartial) return "partial";

  const allUpcoming =
    season.episodes.length > 0 &&
    season.episodes.every((ep) => {
      if (!ep.airDate) return false;
      const t = Date.parse(ep.airDate);
      return Number.isFinite(t) && t > now;
    });
  if (allUpcoming) return "upcoming";
  return "unavailable";
}

/**
 * Adapter that joins canonical seasons + per-server presence into the shape
 * `RequestableSeasons` expects. `counts` is computed from best-of-N presence:
 * each episode contributes `available` when at least one server has it,
 * `upcoming` when its airDate is in the future, otherwise `unavailable`.
 *
 * Specials (`seasonNumber === 0`) are filtered when no server has any
 * episode of them — keeps the accordion clean for shows whose specials are
 * canonical-only.
 *
 * Intentional split with `deriveSeasonStatus`: episode chips use the *union*
 * across servers ("can I watch this episode somewhere?"). Season status uses
 * a *per-server* check (does any single server cover the whole season?) so
 * the request flow can surface a "request the rest" affordance against one
 * library. The split-library edge case where Server A has S1E1–6 and Server
 * B has S1E7–12 will therefore show every episode chip green while the
 * season badge reports `partial` — that is correct: no single library has
 * the season, so a request would still fill a gap.
 */
// fallow-ignore-next-line complexity
export function joinSeasonAvailability(
  canonical: WireSeasonInfo[],
  servers: SeasonAvailabilityServer[],
  now: number = Date.now(),
): Season[] {
  const out: Season[] = [];
  for (const season of canonical) {
    const presenceForSeason = collectPresence(season.seasonNumber, servers);
    if (season.seasonNumber === 0 && presenceForSeason.size === 0) continue;
    const episodes = season.episodes.map<Episode>((ep) =>
      buildEpisode(season, ep, presenceForSeason, now),
    );
    out.push({
      number: season.seasonNumber,
      episodeCount: season.totalEpisodes || episodes.length,
      counts: tallyCounts(episodes),
      episodes,
    });
  }
  return out;
}

function collectPresence(seasonNumber: number, servers: SeasonAvailabilityServer[]): Set<number> {
  const out = new Set<number>();
  for (const s of servers) {
    for (const ep of s.episodesPresent) {
      if (ep.season === seasonNumber) out.add(ep.episode);
    }
  }
  return out;
}

// fallow-ignore-next-line complexity
function buildEpisode(
  season: WireSeasonInfo,
  ep: WireSeasonInfo["episodes"][number],
  presenceForSeason: Set<number>,
  now: number,
): Episode {
  const isPresent = presenceForSeason.has(ep.episodeNumber);
  let status: EpisodeStatus = "unavailable";
  if (isPresent) status = "available";
  else if (ep.airDate && Date.parse(ep.airDate) > now) status = "upcoming";
  return {
    id: `${season.seasonNumber}-${ep.episodeNumber}`,
    episode: ep.episodeNumber,
    title: ep.title,
    airDate: ep.airDate ?? "",
    runtime: ep.runtime ?? 0,
    status,
  };
}

function tallyCounts(episodes: Episode[]): Season["counts"] {
  const counts: Season["counts"] = {};
  for (const ep of episodes) counts[ep.status] = (counts[ep.status] ?? 0) + 1;
  return counts;
}
