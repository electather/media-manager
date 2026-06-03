import { useEffect, useMemo, useState } from "react";
import * as m from "@/paraglide/messages";
import {
  SectionHead,
  SectionHeadCount,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import { cn } from "@/shared/lib/utils";
import { timelineSectionLabel } from "../../lib/labels";
import { toSections } from "../../lib/section-groups";
import { LibrarySectionGrid, type LibrarySectionGridProps } from "./library-section-grid";

// Load-bearing coupling: this id format is the only link between the `<section
// id>` rendered below and the `getElementById` scroll-spy / jump lookup. Both
// sides go through this helper so they stay in step — the connection is
// invisible to the type system, so keep them co-located (mirrors the A→Z lens).
const anchorId = (decade: string) => `lib-decade-${decade}`;

// Top inset for the scroll-spy band — matches the rail's `top-24` (96px) so a
// section only counts as active once it clears the sticky nav. Named so it's
// findable if the nav height changes (there's no shared layout token yet).
const SCROLL_SPY_TOP_INSET = "-96px";

/** Fold a batch of observer entries into the running set of visible section keys. */
function trackVisibleSections(visible: Set<string>, entries: IntersectionObserverEntry[]) {
  for (const entry of entries) {
    const key = (entry.target as HTMLElement).dataset.decade;
    if (key === undefined) continue;
    if (entry.isIntersecting) visible.add(key);
    else visible.delete(key);
  }
}

interface TimelineLensProps extends Omit<LibrarySectionGridProps, "renderHeader"> {
  /** Present-only decades from `/facets`, newest-first, driving the jump rail. */
  decades: number[];
}

/**
 * Release timeline: a sticky decade rail beside per-decade sections (newest
 * first). The server returns the stream sorted `(year DESC, id)` and
 * `toSectionEntries` splices a decade header on each boundary; this lens reuses
 * the shared `LibrarySectionGrid` for the virtualized, infinitely-scrolling body
 * and only adds the rail + scroll-spy on top — mirroring the A→Z lens. Clicking
 * a decade smooth-scrolls to its section; decades absent from the loaded stream
 * are still listed by the whole-library `decades` facet (so the rail is complete
 * before a section scrolls in) but render inert. An IntersectionObserver
 * highlights the section at the top of the viewport.
 *
 * The section keys are i18n-free tokens (`"2020"`, `"unknown"`) emitted by
 * `section-groups`; the visible header text is localized here via
 * `timelineSectionLabel` so the yearless bucket reads "Unknown year" and a
 * decade reads "2020s" in every locale.
 */
export function TimelineLens({ decades, entries, ...gridProps }: TimelineLensProps) {
  // The rail's whole-library decade keys, newest-first, as section-key strings.
  // Sourced from the `decades` facet (not the loaded pages) so a decade links
  // even before its section has scrolled into the infinite stream.
  const railKeys = useMemo(() => decades.map(String), [decades]);
  // The decade keys currently spliced into the loaded stream — the observer only
  // tracks sections that exist in the DOM, and the rail marks a key live only
  // when it is present here. Derived from the same entries the grid renders so
  // the two never disagree. Includes the `"unknown"` bucket when present.
  const presentKeys = useMemo(
    () => new Set(toSections(entries).map((section) => section.key)),
    [entries],
  );
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Scroll-spy via IntersectionObserver (works regardless of which ancestor
  // scrolls). The active decade is the topmost section intersecting a band just
  // below the app nav; while the viewport sits in a gap between sections the
  // last active decade holds. Re-runs when the loaded section set grows.
  useEffect(() => {
    const orderedKeys = [...presentKeys];
    const sections = orderedKeys
      .map((key) => document.getElementById(anchorId(key)))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;
    setActiveKey((prev) => prev ?? orderedKeys[0] ?? null);

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (observed) => {
        trackVisibleSections(visible, observed);
        if (visible.size === 0) return;
        const next = orderedKeys.find((key) => visible.has(key)) ?? null;
        setActiveKey((prev) => (prev === next ? prev : next));
      },
      // Top inset clears the sticky app nav so a section only counts as active
      // once it's below it; the -55% bottom inset narrows the "active band" to
      // the upper ~45% of the viewport.
      { rootMargin: `${SCROLL_SPY_TOP_INSET} 0px -55% 0px`, threshold: 0 },
    );
    for (const el of sections) observer.observe(el);
    return () => observer.disconnect();
  }, [presentKeys]);

  const jump = (decade: string) => {
    document
      .getElementById(anchorId(decade))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="grid grid-cols-[2.25rem_1fr] gap-5 sm:grid-cols-[3rem_1fr] sm:gap-6">
      <nav
        aria-label={m.library_decade_rail_label()}
        className="sticky top-24 flex max-h-[calc(100vh-7rem)] flex-col items-stretch self-start overflow-y-auto"
      >
        {railKeys.map((decade) =>
          presentKeys.has(decade) ? (
            <button
              key={decade}
              type="button"
              aria-label={m.library_decade_jump({ decade: timelineSectionLabel(decade) })}
              aria-current={decade === activeKey ? "true" : undefined}
              onClick={() => jump(decade)}
              className={cn(
                "rounded-md py-1 text-center font-mono text-xs transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                decade === activeKey
                  ? "bg-secondary font-semibold text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {decade}
            </button>
          ) : (
            <span
              key={decade}
              aria-hidden="true"
              className={cn("py-1 text-center font-mono text-xs text-muted-foreground/30")}
            >
              {decade}
            </span>
          ),
        )}
      </nav>

      <LibrarySectionGrid
        entries={entries}
        {...gridProps}
        renderHeader={(section) => (
          <SectionHead>
            <SectionHeadHeading>
              <div id={anchorId(section.key)} data-decade={section.key} className="scroll-mt-28">
                <SectionHeadTitle>
                  {timelineSectionLabel(section.label)}
                  <SectionHeadCount value={section.count} />
                </SectionHeadTitle>
              </div>
            </SectionHeadHeading>
          </SectionHead>
        )}
      />
    </div>
  );
}
