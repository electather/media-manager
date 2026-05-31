import { useMemo } from "react";
import { groupByDecade } from "../../lib/grouping";
import type { LibraryItem } from "../../lib/types";
import { LibraryCard } from "../library-card";
import { LibrarySectionHeader } from "./library-section-header";

/**
 * Release timeline: one row per decade (newest first), each a horizontally
 * scrollable, snap-aligned strip of titles ordered newest-to-oldest within.
 */
export function TimelineLens({ items }: { items: LibraryItem[] }) {
  const decades = useMemo(() => groupByDecade(items), [items]);

  return (
    <div className="flex flex-col gap-12">
      {decades.map((decade) => (
        <section key={decade.key}>
          <LibrarySectionHeader label={decade.label} count={decade.items.length} />
          <ul className="-mx-1 flex snap-x snap-proximity gap-4 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
            {decade.items.map((item) => (
              <li key={item.id} className="w-36 shrink-0 snap-start sm:w-40">
                <LibraryCard item={item} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
