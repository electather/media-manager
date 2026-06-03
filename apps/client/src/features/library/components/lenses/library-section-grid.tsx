import { useCallback, useMemo, type ReactNode } from "react";
import * as m from "@/paraglide/messages";
import {
  SectionHead,
  SectionHeadCount,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import { VirtualGrid } from "@/shared/components/virtualized";
import { Button } from "@/shared/ui/button";
import { toSections, type LibrarySectionEntry } from "../../lib/section-groups";
import { LibraryCard } from "../library-card";

/**
 * Tile geometry shared with `LIBRARY_GRID_CLASS` so the virtualized grid packs
 * the same column track the non-virtual lenses (and the loading skeleton) use:
 * `minmax(8rem, 1fr)` columns at the base breakpoint with the `gap-x-3.5` (14px)
 * gutter. `EST_ROW_HEIGHT` is the empirical poster-card row height (2/3 poster +
 * title/year footer + gap) the virtualizer seeds each row with before measuring.
 */
const MIN_COLUMN_PX = 128;
const GAP_PX = 14;
const EST_ROW_HEIGHT = 296;

/**
 * Whether the `onEndReached` sentinel should kick off the next page fetch: only
 * when another cursor exists AND no fetch is already in flight. Extracted as a
 * pure predicate so the infinite-scroll guard is unit-testable without rendering
 * the virtualizer (the grid's `onEndReached` and the "load more" button both go
 * through it, so the two affordances never disagree).
 */
export function shouldFetchNext(hasNextPage: boolean, isFetchingNextPage: boolean): boolean {
  return hasNextPage && !isFetchingNextPage;
}

export interface LibrarySectionGridProps {
  /** The flat, server-sorted stream with section headers already spliced in. */
  entries: LibrarySectionEntry[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => Promise<unknown>;
  /**
   * Optional per-section header override (the A→Z lens anchors its sections for
   * the letter rail). Defaults to the shared `SectionHead` treatment so every
   * other lens reads the same.
   */
  renderHeader?: (section: { key: string; label: string; count: number }) => ReactNode;
}

/**
 * The infinite-scroll body shared by the four item lenses. Splits the flat
 * header-delimited stream into sections and renders each as a `SectionHead`
 * over its own window-virtualized poster grid — the exact "header over a grid"
 * look the client-side `groupBy*` produced, now fed by the server's sorted
 * stream. The shared `VirtualGrid` is reused unchanged (rule: reuse, don't
 * reinvent); only the LAST section wires `onEndReached`, so the single
 * end-of-stream nears the viewport and fetches the next cursor (guarded by
 * `hasNextPage && !isFetchingNextPage` per the grid contract). Each cell keys on
 * `${id}-${sectionKey}` so the `server`/`quality` lenses' repeated titles keep
 * distinct DOM rows. A "load more" button mirrors watchlist as the keyboard /
 * non-scroll affordance.
 */
export function LibrarySectionGrid({
  entries,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  renderHeader,
}: LibrarySectionGridProps) {
  const sections = useMemo(() => toSections(entries), [entries]);
  const onEndReached = useCallback(() => {
    if (shouldFetchNext(hasNextPage, isFetchingNextPage)) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="flex flex-col gap-14">
      {sections.map((section, index) => {
        const isLast = index === sections.length - 1;
        return (
          <section key={section.key}>
            {renderHeader ? (
              renderHeader({ key: section.key, label: section.label, count: section.items.length })
            ) : (
              <SectionHead>
                <SectionHeadHeading>
                  <SectionHeadTitle>
                    {section.label}
                    <SectionHeadCount value={section.items.length} />
                  </SectionHeadTitle>
                </SectionHeadHeading>
              </SectionHead>
            )}
            <VirtualGrid
              items={section.items}
              getKey={(entry) => `${entry.item.id}-${entry.sectionKey}`}
              minColumnWidthPx={MIN_COLUMN_PX}
              gapPx={GAP_PX}
              estimateRowHeight={() => EST_ROW_HEIGHT}
              renderItem={(entry) => <LibraryCard item={entry.item} />}
              onEndReached={isLast ? onEndReached : undefined}
            />
          </section>
        );
      })}

      {hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? m.library_loading_more() : m.library_load_more()}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
