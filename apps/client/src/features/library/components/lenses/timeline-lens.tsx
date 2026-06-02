import { useMemo, type CSSProperties } from "react";
import * as m from "@/paraglide/messages";
import {
  SectionHead,
  SectionHeadActions,
  SectionHeadCount,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import {
  ScrollRow,
  ScrollRowNextButton,
  ScrollRowPrevButton,
  ScrollRowTrack,
  ScrollRowViewport,
} from "@/shared/components/scroll-row";
import { groupByDecade } from "../../lib/grouping";
import type { LibraryItem } from "../../lib/types";
import { LibraryCard } from "../library-card";

interface CardWidthVars extends CSSProperties {
  "--card-w": string;
  "--card-h": string;
}

const POSTER_VARS: CardWidthVars = { "--card-w": "200px", "--card-h": "300px" };

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
      {decades.map((decade) => (
        <ScrollRow key={decade.key} revalidationKey={decade.items.length}>
          <SectionHead>
            <SectionHeadHeading>
              <SectionHeadTitle>
                {decade.label}
                <SectionHeadCount value={decade.items.length} />
              </SectionHeadTitle>
            </SectionHeadHeading>
            <SectionHeadActions>
              <ScrollRowPrevButton aria-label={m.library_row_prev({ decade: decade.label })} />
              <ScrollRowNextButton aria-label={m.library_row_next({ decade: decade.label })} />
            </SectionHeadActions>
          </SectionHead>
          <ScrollRowViewport style={POSTER_VARS}>
            <ScrollRowTrack
              virtualize
              aria-label={decade.label}
              className="pb-1"
              items={decade.items}
              getKey={(item) => item.id}
              estimateItemWidth={200}
              renderItem={(item) => <LibraryCard item={item} />}
            />
          </ScrollRowViewport>
        </ScrollRow>
      ))}
    </div>
  );
}
