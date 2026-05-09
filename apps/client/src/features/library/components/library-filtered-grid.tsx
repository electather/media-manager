import * as m from "@/paraglide/messages";
import { Card } from "@/features/home/components/card";
import type { LibraryFilter, LibraryItem, LibrarySort } from "../lib/types";
import { SectionHead } from "./section-head";

interface LibraryFilteredGridProps {
  items: readonly LibraryItem[];
  filter: LibraryFilter;
  sort: LibrarySort;
  onPeek: (id: string) => void;
}

const FILTER_LABELS: Record<LibraryFilter, () => string> = {
  all: () => m.library_filter_all(),
  ready: () => m.library_filter_ready(),
  "in-progress": () => m.library_filter_in_progress(),
  awaiting: () => m.library_filter_awaiting(),
  upcoming: () => m.library_filter_upcoming(),
};

const SORT_LABELS: Record<LibrarySort, () => string> = {
  recent: () => m.library_sort_recent(),
  alpha: () => m.library_sort_alpha(),
  runtime: () => m.library_sort_runtime(),
  status: () => m.library_sort_status(),
};

export function LibraryFilteredGrid({ items, filter, sort, onPeek }: LibraryFilteredGridProps) {
  return (
    <section>
      <SectionHead
        eyebrow={m.library_filtered_eyebrow({
          filter: FILTER_LABELS[filter](),
          sort: SORT_LABELS[sort](),
        })}
        title={m.library_filtered_title()}
        count={items.length}
      />
      <div
        className="grid gap-x-4 gap-y-5"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}
      >
        {items.map((it) => (
          <Card key={it.id} item={it} rowKind="yourWatchlist" forceAspect="2/3" onClick={onPeek} />
        ))}
      </div>
    </section>
  );
}
