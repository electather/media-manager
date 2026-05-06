import type { MatchReason } from "@ent-mcp/shared/home";
import type { TopContributor } from "../catalog/types";
import type { InternalCompactMediaItem, RowContext } from "./types";

const FINISHING_SOON_THRESHOLD = 0.85;
const RECENTLY_ADDED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Resolves a typed `MatchReason` for a row item. The orchestrator calls this
 * once per item during enrichment; the row's slug picks the branch and the
 * surrounding context (seed title, top contributors, server-stitched flag)
 * supplies the ICU params.
 *
 * Trending / new-release rows return null — the chip is hidden by design.
 */
// fallow-ignore-next-line complexity
export function pickMatchReason(
  rowId: string,
  item: InternalCompactMediaItem,
  ctx: RowContext,
): MatchReason | null {
  switch (rowId) {
    case "continueWatching-active": {
      if (progressFraction(item) >= FINISHING_SOON_THRESHOLD) {
        return { key: "finishing_soon", params: {} };
      }
      return { key: "matches_recent_picks", params: { n: String(ctx.recentPickCount ?? 4) } };
    }
    case "continueWatching-next":
      if (item.seriesContext?.nextUpFromServer) {
        return { key: "from_active_series", params: {} };
      }
      return { key: "continuing_series", params: {} };
    case "becauseYouWatched":
      return { key: "similar_to_seed", params: { seedTitle: ctx.seedTitle ?? "" } };
    case "recommendedForYou-tv":
    case "recommendedForYou-movies":
      return mapTopContributor(item.__topContributors ?? []);
    case "yourWatchlist":
      if (recentlyAdded(item)) return { key: "recently_added", params: {} };
      return { key: "because_in_watchlist", params: {} };
    case "upcomingForYou":
      return { key: "upcoming_release", params: {} };
    case "trendingNow":
    case "newReleases":
      return null;
  }
  return null;
}

/**
 * Maps the leading `topContributors` entry to a chip. Falls back to
 * `highly_rated` when the snapshot is empty (legacy rec-list rows).
 * Non-genre categories collapse to `matches_recent_picks` rather than
 * inventing copy per category — keeps the v1 chip surface tight.
 */
// fallow-ignore-next-line complexity
export function mapTopContributor(contribs: readonly TopContributor[]): MatchReason {
  if (contribs.length === 0) return { key: "highly_rated", params: {} };
  const top = contribs[0]!;
  switch (top.category) {
    case "genre":
      return { key: "from_genre_you_love", params: { genre: top.value } };
    case "person":
    case "keyword":
    case "decade":
    case "language":
    case "runtime":
      return { key: "matches_recent_picks", params: { n: String(contribs.length) } };
  }
}

function progressFraction(item: InternalCompactMediaItem): number {
  const p = item.progress;
  if (!p || p.total <= 0) return 0;
  return p.watched / p.total;
}

function recentlyAdded(item: InternalCompactMediaItem): boolean {
  const release = item.facets?.releaseDate;
  if (!release) return false;
  const ts = Date.parse(release);
  if (Number.isNaN(ts)) return false;
  return Date.now() - ts < RECENTLY_ADDED_WINDOW_MS;
}
