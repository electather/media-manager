import * as m from "@/paraglide/messages";
import type { RowKind } from "@ent-mcp/shared/home";

/**
 * Maps the active hero slide's `RowKind` to the existing Paraglide row-header
 * message key. The hero mixer only emits four sources today
 * (`continueWatching`, `recommendedForYou`, `trendingNow`, `newReleases`).
 *
 * Other `RowKind` members reach this resolver only by mistake — surface a
 * loud failure rather than silently labelling a hero slide with the wrong
 * row header. If the mixer starts emitting a new source, add a dedicated
 * label here and the type-checker will guide every call site.
 */
const LABELS: Partial<Record<RowKind, () => string>> = {
  continueWatching: m.home_row_continueWatching_header,
  recommendedForYou: m.home_row_recommendedForYou_header,
  trendingNow: m.home_row_trendingNow_header,
  newReleases: m.home_row_newReleases_header,
};

export function sourceLabel(source: RowKind): string {
  const label = LABELS[source];
  if (!label) {
    throw new Error(`sourceLabel: hero mixer should not emit RowKind "${source}"`);
  }
  return label();
}
