import * as m from "@/paraglide/messages";
import type { LibraryItem, RecentLogEntry } from "./types";

export function shortRuntimeLabel(item: LibraryItem): string {
  if (item.mediaType === "tv") {
    const eps = item.facets?.episodeCount ?? 8;
    return m.library_episodes_count({ n: String(eps) });
  }
  const min = item.facets?.runtimeMin;
  if (typeof min !== "number") return "";
  const h = Math.floor(min / 60);
  const mm = min % 60;
  return h > 0
    ? m.library_runtime_hours_minutes({ hours: String(h), minutes: String(mm) })
    : m.library_runtime_minutes({ minutes: String(mm) });
}

export function recentTimeLabel(entry: RecentLogEntry): string {
  const t = entry.time;
  if (t.kind === "hours-ago") return m.library_recent_time_hours_ago({ n: String(t.n) });
  if (t.kind === "days-ago") return m.library_recent_time_days_ago({ n: String(t.n) });
  if (t.kind === "yesterday") return m.library_recent_time_yesterday();
  return m.library_recent_time_last_week();
}
