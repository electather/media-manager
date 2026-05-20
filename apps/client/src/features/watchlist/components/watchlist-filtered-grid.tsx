import * as m from "@/paraglide/messages";
import { WatchlistCard } from "./watchlist-card";
import {
  SectionHead,
  SectionHeadCount,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import type { WatchlistFilter, WatchlistItem, WatchlistSort } from "../lib/types";

interface WatchlistFilteredGridProps {
  items: readonly WatchlistItem[];
  filter: WatchlistFilter;
  sort: WatchlistSort;
  onPeek: (id: string) => void;
}

const FILTER_LABELS: Record<WatchlistFilter, () => string> = {
  all: () => m.watchlist_filter_all(),
  ready: () => m.watchlist_filter_ready(),
  "in-progress": () => m.watchlist_filter_in_progress(),
  awaiting: () => m.watchlist_filter_awaiting(),
  upcoming: () => m.watchlist_filter_upcoming(),
};

const SORT_LABELS: Record<WatchlistSort, () => string> = {
  recent: () => m.watchlist_sort_recent(),
  alpha: () => m.watchlist_sort_alpha(),
  runtime: () => m.watchlist_sort_runtime(),
  status: () => m.watchlist_sort_status(),
};

export function WatchlistFilteredGrid({ items, filter, sort, onPeek }: WatchlistFilteredGridProps) {
  return (
    <section>
      <SectionHead>
        <SectionHeadHeading>
          <SectionHeadEyebrow>
            {m.watchlist_filtered_eyebrow({
              filter: FILTER_LABELS[filter](),
              sort: SORT_LABELS[sort](),
            })}
          </SectionHeadEyebrow>
          <SectionHeadTitle>
            {m.watchlist_filtered_title()}
            <SectionHeadCount value={items.length} />
          </SectionHeadTitle>
        </SectionHeadHeading>
      </SectionHead>
      <div
        className="grid gap-x-4 gap-y-5"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}
      >
        {items.map((it) => (
          <WatchlistCard
            key={it.id}
            item={it}
            rowKind="yourWatchlist"
            forceAspect="2/3"
            onPeek={onPeek}
          />
        ))}
      </div>
    </section>
  );
}
