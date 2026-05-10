import * as m from "@/paraglide/messages";
import type { WatchlistItem } from "./types";

const TV_DEFAULT_RUNTIME_MIN = 48;
const TV_DEFAULT_EPISODES = 8;
const MOVIE_DEFAULT_RUNTIME_MIN = 110;

// fallow-ignore-next-line complexity
function itemRuntimeMinutes(item: WatchlistItem): number {
  const runtimeMin = item.facets?.runtimeMin;
  if (item.mediaType === "tv") {
    const episodes = item.facets?.episodeCount ?? TV_DEFAULT_EPISODES;
    return (runtimeMin ?? TV_DEFAULT_RUNTIME_MIN) * episodes;
  }
  return runtimeMin ?? MOVIE_DEFAULT_RUNTIME_MIN;
}

/**
 * Sums total runtime for a list of watchlist items. TV multiplies the per-
 * episode runtime by the episode count; missing facets fall back to coarse
 * defaults so the header chip never reads "0h".
 */
export function totalRuntimeMinutes(items: readonly WatchlistItem[]): number {
  let total = 0;
  for (const it of items) total += itemRuntimeMinutes(it);
  return total;
}

/** Picks the runtime-budget paraglide variant by whether the total spans days. */
export function formatRuntimeBudget(min: number): string {
  const days = Math.floor(min / (60 * 24));
  const hours = Math.floor((min % (60 * 24)) / 60);
  if (days > 0)
    return m.watchlist_runtime_budget_days_hours({ days: String(days), hours: String(hours) });
  return m.watchlist_runtime_budget_hours({ hours: String(hours) });
}

function formatMovieRuntime(runtimeMin: number): string {
  const hours = Math.floor(runtimeMin / 60);
  const minutes = runtimeMin % 60;
  if (hours > 0)
    return m.watchlist_runtime_movie_hours_minutes({
      hours: String(hours),
      minutes: String(minutes),
    });
  return m.watchlist_runtime_movie_minutes({ minutes: String(minutes) });
}

/** Card-strip runtime: "1h 45m" for movies, "8 eps" for TV. */
// fallow-ignore-next-line complexity
export function shortRuntime(item: WatchlistItem): string {
  if (item.mediaType === "tv") {
    return m.watchlist_runtime_tv_episodes({
      n: String(item.facets?.episodeCount ?? TV_DEFAULT_EPISODES),
    });
  }
  const runtimeMin = item.facets?.runtimeMin;
  if (typeof runtimeMin !== "number") return "";
  return formatMovieRuntime(runtimeMin);
}
