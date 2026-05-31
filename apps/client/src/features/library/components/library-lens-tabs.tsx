import * as m from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";
import { lensLabel, lensNote } from "../lib/labels";
import { LIBRARY_LENSES, type LibraryLens } from "../lib/types";

interface LibraryLensTabsProps {
  value: LibraryLens;
  onChange: (lens: LibraryLens) => void;
}

/**
 * The lens switcher — a segmented control where each tab stacks a label over a
 * mono "note" (Index / By era / …). Switching tabs re-groups the same filtered
 * item set rather than refetching.
 */
export function LibraryLensTabs({ value, onChange }: LibraryLensTabsProps) {
  return (
    <div
      role="tablist"
      aria-label={m.library_lens_tabs_label()}
      className="inline-flex gap-1 rounded-lg border bg-card p-1"
    >
      {LIBRARY_LENSES.map((lens) => {
        const active = lens === value;
        return (
          <button
            key={lens}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(lens)}
            className={cn(
              "flex flex-col items-start gap-0.5 rounded-md px-3 py-1.5 text-start transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="text-sm font-medium leading-none">{lensLabel(lens)}</span>
            <span
              className={cn(
                "font-mono text-[0.5625rem] uppercase tracking-wider leading-none",
                active ? "text-primary" : "text-muted-foreground/70",
              )}
            >
              {lensNote(lens)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
