import * as m from "@/paraglide/messages";
import type { CompactMediaItem } from "@ent-mcp/shared/media";

function movieRuntimeLabel(min: number): string {
  const h = Math.floor(min / 60);
  const mm = min % 60;
  return h > 0
    ? m.watchlist_runtime_hours_minutes({ hours: String(h), minutes: String(mm) })
    : m.watchlist_runtime_minutes({ minutes: String(mm) });
}

// fallow-ignore-next-line complexity
export function shortRuntimeLabel(item: CompactMediaItem): string {
  if (item.mediaType === "tv") {
    return m.watchlist_episodes_count({ n: String(item.facets?.episodeCount ?? 8) });
  }
  const min = item.facets?.runtimeMin;
  return typeof min === "number" ? movieRuntimeLabel(min) : "";
}
