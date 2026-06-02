import { useEffect, useMemo, useState } from "react";
import * as m from "@/paraglide/messages";
import {
  SectionHead,
  SectionHeadCount,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import { cn } from "@/shared/lib/utils";
import { buildAlphabet, groupByLetter } from "../../lib/grouping";
import type { LibraryItem } from "../../lib/types";
import { LibraryGrid } from "../library-grid";

// Load-bearing coupling: this id format is the only link between the `<section
// id>` below and the `getElementById` scroll-spy lookup in the effect. Both
// sides go through this helper, so changing it here keeps them in step — but
// the connection is invisible to the type system, so keep them co-located.
const anchorId = (letter: string) => `lib-letter-${letter === "#" ? "hash" : letter}`;

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

/**
 * Alphabetical index: a sticky letter rail beside per-letter sections. Clicking
 * a populated letter smooth-scrolls to its section; empty letters are inert. An
 * IntersectionObserver tracks which section sits at the top of the viewport and
 * highlights the matching rail letter.
 */
export function AzLens({ items }: { items: LibraryItem[] }) {
  const groups = useMemo(() => groupByLetter(items), [items]);
  const alphabet = useMemo(() => buildAlphabet(items), [items]);
  // Highlight the first section from the start; the observer below corrects it
  // as soon as the user scrolls. Without this the rail shows nothing active on
  // load even though section `A` is already at the top of the viewport.
  const [activeKey, setActiveKey] = useState<string | null>(groups[0]?.key ?? null);

  // Scroll-spy via IntersectionObserver (works regardless of which ancestor
  // scrolls). The active letter is the topmost section intersecting a band just
  // below the app nav; while the viewport sits in a gap between sections the last
  // active letter holds. Only re-renders when the active letter actually changes.
  useEffect(() => {
    const keys = groups.map((group) => group.key);
    const sections = keys
      .map((key) => document.getElementById(anchorId(key)))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        trackVisibleSections(visible, entries);
        if (visible.size === 0) return;
        const next = keys.find((key) => visible.has(key)) ?? null;
        setActiveKey((prev) => (prev === next ? prev : next));
      },
      // Top inset clears the sticky app nav so a section only counts as active
      // once it's below it; the -55% bottom inset narrows the "active band" to
      // the upper ~45% of the viewport.
      { rootMargin: `${SCROLL_SPY_TOP_INSET} 0px -55% 0px`, threshold: 0 },
    );
    for (const el of sections) observer.observe(el);
    return () => observer.disconnect();
  }, [groups]);

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
        {alphabet.map(({ letter, populated }) =>
          populated ? (
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

      <div className="flex flex-col gap-14">
        {groups.map((group) => (
          <section
            key={group.key}
            id={anchorId(group.key)}
            data-letter={group.key}
            className="scroll-mt-28"
          >
            <SectionHead>
              <SectionHeadHeading>
                <SectionHeadTitle className="text-5xl font-bold leading-none">
                  {group.label}
                  <SectionHeadCount value={group.items.length} />
                </SectionHeadTitle>
              </SectionHeadHeading>
            </SectionHead>
            <LibraryGrid items={group.items} />
          </section>
        ))}
      </div>
    </div>
  );
}
