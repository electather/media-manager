import { useMemo } from "react";
import * as m from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";
import { buildAlphabet, groupByLetter } from "../../lib/grouping";
import type { LibraryItem } from "../../lib/types";
import { LibraryGrid } from "../library-grid";
import { LibrarySectionHeader } from "./library-section-header";

const anchorId = (letter: string) => `lib-letter-${letter === "#" ? "hash" : letter}`;

/**
 * Alphabetical index: a sticky letter rail beside per-letter sections. Clicking
 * a populated letter smooth-scrolls to its section; empty letters are inert.
 */
export function AzLens({ items }: { items: LibraryItem[] }) {
  const groups = useMemo(() => groupByLetter(items), [items]);
  const alphabet = useMemo(() => buildAlphabet(items), [items]);

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
              onClick={() => jump(letter)}
              className="rounded-md py-1 text-center font-mono text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          <section key={group.key} id={anchorId(group.key)} className="scroll-mt-28">
            <LibrarySectionHeader label={group.label} count={group.items.length} size="display" />
            <LibraryGrid items={group.items} />
          </section>
        ))}
      </div>
    </div>
  );
}
