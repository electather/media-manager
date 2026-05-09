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

function filterLabel(filter: LibraryFilter): string {
  if (filter === "ready") return m.library_filter_ready();
  if (filter === "in-progress") return m.library_filter_in_progress();
  if (filter === "awaiting") return m.library_filter_awaiting();
  if (filter === "upcoming") return m.library_filter_upcoming();
  return m.library_filter_all();
}

function sortLabel(sort: LibrarySort): string {
  if (sort === "alpha") return m.library_sort_alpha();
  if (sort === "runtime") return m.library_sort_runtime();
  if (sort === "status") return m.library_sort_status();
  return m.library_sort_recent();
}

export function LibraryFilteredGrid({ items, filter, sort, onPeek }: LibraryFilteredGridProps) {
  return (
    <section>
      <SectionHead
        eyebrow={m.library_filtered_eyebrow({
          filter: filterLabel(filter),
          sort: sortLabel(sort),
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
