import { useMemo } from "react";
import * as m from "@/paraglide/messages";
import {
  SectionHead,
  SectionHeadActions,
  SectionHeadCount,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import {
  POSTER_VARS,
  ScrollRow,
  ScrollRowNextButton,
  ScrollRowPrevButton,
  ScrollRowTrack,
  ScrollRowViewport,
} from "@/shared/components/scroll-row";
import { groupByDecade } from "../../lib/grouping";
import type { LibraryItem } from "../../lib/types";
import { LibraryCard } from "../library-card";

/**
 * Release timeline: one row per decade (newest first), each ordered
 * newest-to-oldest within. Composes the shared `ScrollRow` primitives so the
 * scroll behaviour, edge fades, and card sizing match the home feed and
 * watchlist rows exactly rather than re-implementing a horizontal strip.
 */
export function TimelineLens({ items }: { items: LibraryItem[] }) {
  const decades = useMemo(() => groupByDecade(items), [items]);

  return (
    <div className="flex flex-col gap-12">
      {decades.map((decade) => {
        // Yearless titles land in the `unknown` bucket grouping appends last; its
        // label is localized here so the lib layer can stay i18n-free.
        const label = decade.key === "unknown" ? m.library_timeline_unknown() : decade.label;
        return (
          <ScrollRow key={decade.key} revalidationKey={decade.items.length}>
            <SectionHead>
              <SectionHeadHeading>
                <SectionHeadTitle>
                  {label}
                  <SectionHeadCount value={decade.items.length} />
                </SectionHeadTitle>
              </SectionHeadHeading>
              <SectionHeadActions>
                <ScrollRowPrevButton aria-label={m.library_row_prev({ decade: label })} />
                <ScrollRowNextButton aria-label={m.library_row_next({ decade: label })} />
              </SectionHeadActions>
            </SectionHead>
            <ScrollRowViewport style={POSTER_VARS}>
              <ScrollRowTrack
                virtualize
                aria-label={label}
                className="pb-1"
                items={decade.items}
                getKey={(item) => item.id}
                estimateItemWidth={200}
                renderItem={(item) => <LibraryCard item={item} />}
              />
            </ScrollRowViewport>
          </ScrollRow>
        );
      })}
    </div>
  );
}
