import * as m from "@/paraglide/messages";
import { Card } from "@/features/home/components/card";
import type { WatchlistFilter, WatchlistItem, WatchlistSort } from "../lib/types";
import { SectionHead } from "./section-head";

interface FilteredViewProps {
  items: readonly WatchlistItem[];
  filter: Exclude<WatchlistFilter, "all">;
  sort: WatchlistSort;
  onPeek: (id: string) => void;
}

const FILTER_LABEL: Record<Exclude<WatchlistFilter, "all">, () => string> = {
  available: () => m.watchlist_filter_ready(),
  "in-progress": () => m.watchlist_filter_in_progress(),
  requested: () => m.watchlist_filter_awaiting(),
  upcoming: () => m.watchlist_filter_upcoming(),
};

function eyebrowFor(filter: Exclude<WatchlistFilter, "all">, sort: WatchlistSort): string {
  const label = FILTER_LABEL[filter]();
  if (sort === "alpha") return m.watchlist_filtered_eyebrow_alpha({ label });
  if (sort === "runtime") return m.watchlist_filtered_eyebrow_runtime({ label });
  if (sort === "status") return m.watchlist_filtered_eyebrow_status({ label });
  return m.watchlist_filtered_eyebrow_recent({ label });
}

export function FilteredView({ items, filter, sort, onPeek }: FilteredViewProps) {
  return (
    <section>
      <SectionHead
        eyebrow={eyebrowFor(filter, sort)}
        title={m.watchlist_filtered_view_title()}
        count={items.length}
      />
      <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]">
        {items.map((it) => (
          <Card key={it.id} item={it} rowKind="yourWatchlist" forceAspect="2/3" onClick={onPeek} />
        ))}
      </div>
    </section>
  );
}
