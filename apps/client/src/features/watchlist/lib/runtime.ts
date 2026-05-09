import * as m from "@/paraglide/messages";
import type { WatchlistItem } from "./types";

/**
 * Sums total runtime for a list of watchlist items. TV multiplies the per-
 * episode runtime by the episode count; missing facets fall back to coarse
 * defaults so the header chip never reads "0h".
 */
export function totalRuntimeMinutes(items: readonly WatchlistItem[]): number {
  let total = 0;
  for (const it of items) {
    const runtimeMin = it.facets?.runtimeMin;
    if (typeof runtimeMin === "number") {
      total += it.mediaType === "tv" ? runtimeMin * (it.facets?.episodeCount ?? 8) : runtimeMin;
    } else if (it.mediaType === "tv") {
      total += 48 * 8;
    } else {
      total += 110;
    }
  }
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

/** Card-strip runtime: "1h 45m" for movies, "8 eps" for TV. */
export function shortRuntime(item: WatchlistItem): string {
  if (item.mediaType === "tv") {
    return m.watchlist_runtime_tv_episodes({ n: String(item.facets?.episodeCount ?? 8) });
  }
  const runtimeMin = item.facets?.runtimeMin;
  if (typeof runtimeMin !== "number") return "";
  const hours = Math.floor(runtimeMin / 60);
  const minutes = runtimeMin % 60;
  if (hours > 0)
    return m.watchlist_runtime_movie_hours_minutes({
      hours: String(hours),
      minutes: String(minutes),
    });
  return m.watchlist_runtime_movie_minutes({ minutes: String(minutes) });
}
