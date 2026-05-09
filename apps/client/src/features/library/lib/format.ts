import * as m from "@/paraglide/messages";
import type { LibraryItem, RecentLogEntry } from "./types";

function movieRuntimeLabel(min: number): string {
  const h = Math.floor(min / 60);
  const mm = min % 60;
  return h > 0
    ? m.library_runtime_hours_minutes({ hours: String(h), minutes: String(mm) })
    : m.library_runtime_minutes({ minutes: String(mm) });
}

// fallow-ignore-next-line complexity
export function shortRuntimeLabel(item: LibraryItem): string {
  if (item.mediaType === "tv") {
    return m.library_episodes_count({ n: String(item.facets?.episodeCount ?? 8) });
  }
  const min = item.facets?.runtimeMin;
  return typeof min === "number" ? movieRuntimeLabel(min) : "";
}

const TIME_LABELLERS: Record<
  RecentLogEntry["time"]["kind"],
  (t: RecentLogEntry["time"]) => string
> = {
  "hours-ago": (t) => m.library_recent_time_hours_ago({ n: String((t as { n: number }).n) }),
  "days-ago": (t) => m.library_recent_time_days_ago({ n: String((t as { n: number }).n) }),
  yesterday: () => m.library_recent_time_yesterday(),
  "last-week": () => m.library_recent_time_last_week(),
};

export function recentTimeLabel(entry: RecentLogEntry): string {
  return TIME_LABELLERS[entry.time.kind](entry.time);
}
