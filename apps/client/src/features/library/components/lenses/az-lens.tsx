import { useEffect, useMemo, useState } from "react";
import * as m from "@/paraglide/messages";
import {
  SectionHead,
  SectionHeadCount,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import { cn } from "@/shared/lib/utils";
import { toSections } from "../../lib/section-groups";
import { LibrarySectionGrid, type LibrarySectionGridProps } from "./library-section-grid";

// Load-bearing coupling: this id format is the only link between the `<section
// id>` rendered below and the `getElementById` scroll-spy lookup in the effect.
// Both sides go through this helper, so changing it here keeps them in step —
// but the connection is invisible to the type system, so keep them co-located.
const anchorId = (letter: string) => `lib-letter-${letter === "#" ? "hash" : letter}`;

// The fixed A→Z rail order; `#` collects non-alphabetic leads. The `letters`
// facet (present-only) decides which entries are live links vs inert.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").concat("#");

// Top inset for the scroll-spy band — matches the rail's `top-24` (96px) so a
// section only counts as active once it clears the sticky nav. Named so it's
// findable if the nav height changes (there's no shared layout token yet).
const SCROLL_SPY_TOP_INSET = "-96px";

/** Fold a batch of observer entries into the running set of visible section keys. */
function trackVisibleSections(visible: Set<string>, entries: IntersectionObserverEntry[]) {
  for (const entry of entries) {
    const key = (entry.target as HTMLElement).dataset.letter;
    if (key === undefined) continue;
    if (entry.isIntersecting) visible.add(key);
    else visible.delete(key);
  }
}

interface AzLensProps extends Omit<LibrarySectionGridProps, "renderHeader"> {
  /** Present-only first letters from `/facets`, driving which rail letters link. */
  letters: string[];
}

/**
 * Alphabetical index: a sticky letter rail beside per-letter sections. The
 * server returns the stream sorted `(sortTitle, id)` and `toSectionEntries`
 * splices a letter header on each boundary; this lens reuses the shared
 * `LibrarySectionGrid` for the virtualized, infinitely-scrolling body and only
 * adds the rail + scroll-spy on top. Clicking a populated letter smooth-scrolls
 * to its section; letters absent from the `letters` facet are inert. An
 * IntersectionObserver highlights the section at the top of the viewport.
 */
export function AzLens({ letters, entries, ...gridProps }: AzLensProps) {
  // The populated set drives the rail's live vs inert letters and is sourced
  // from the whole-library `letters` facet (not the loaded pages) so a letter
  // links even before its section has scrolled into the infinite stream.
  const populated = useMemo(() => new Set(letters), [letters]);
  // The section keys currently spliced into the loaded stream — the observer
  // only tracks sections that exist in the DOM. Derived from the same entries
  // the grid renders so the two never disagree.
  const sectionKeys = useMemo(() => toSections(entries).map((section) => section.key), [entries]);
  const [activeKey, setActiveKey] = useState<string | null>(null);

  // Scroll-spy via IntersectionObserver (works regardless of which ancestor
  // scrolls). The active letter is the topmost section intersecting a band just
  // below the app nav; while the viewport sits in a gap between sections the
  // last active letter holds. Re-runs when the loaded section set grows.
  useEffect(() => {
    const sections = sectionKeys
      .map((key) => document.getElementById(anchorId(key)))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;
    setActiveKey((prev) => prev ?? sectionKeys[0] ?? null);

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (observed) => {
        trackVisibleSections(visible, observed);
        if (visible.size === 0) return;
        const next = sectionKeys.find((key) => visible.has(key)) ?? null;
        setActiveKey((prev) => (prev === next ? prev : next));
      },
      // Top inset clears the sticky app nav so a section only counts as active
      // once it's below it; the -55% bottom inset narrows the "active band" to
      // the upper ~45% of the viewport.
      { rootMargin: `${SCROLL_SPY_TOP_INSET} 0px -55% 0px`, threshold: 0 },
    );
    for (const el of sections) observer.observe(el);
    return () => observer.disconnect();
  }, [sectionKeys]);

  const jump = (letter: string) => {
    document
      .getElementById(anchorId(letter))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="grid grid-cols-[2.25rem_1fr] gap-5 sm:grid-cols-[3rem_1fr] sm:gap-6">
      <nav
        aria-label={m.library_az_rail_label()}
        className="sticky top-24 flex max-h-[calc(100vh-7rem)] flex-col items-stretch self-start overflow-y-auto"
      >
        {ALPHABET.map((letter) =>
          populated.has(letter) ? (
            <button
              key={letter}
              type="button"
              aria-label={m.library_az_jump({ letter })}
              aria-current={letter === activeKey ? "true" : undefined}
              onClick={() => jump(letter)}
              className={cn(
                "rounded-md py-1 text-center font-mono text-xs transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                letter === activeKey
                  ? "bg-secondary font-semibold text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {letter}
            </button>
          ) : (
            <span
              key={letter}
              aria-hidden="true"
              className={cn("py-1 text-center font-mono text-xs text-muted-foreground/30")}
            >
              {letter}
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
              <div id={anchorId(section.key)} data-letter={section.key} className="scroll-mt-28">
                <SectionHeadTitle className="text-5xl font-bold leading-none">
                  {section.label}
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
