import * as m from "@/paraglide/messages";
import type { RowKind } from "@nama/shared/home";

/** Only four sources today; unmapped kinds throw to catch accidental new emitters and guide call sites. */
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
