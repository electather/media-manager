import * as m from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";

interface LibrarySectionHeaderProps {
  label: string;
  count: number;
  /** The A→Z lens uses oversized letter headings; other lenses use the regular size. */
  size?: "regular" | "display";
}

/** Shared section heading: a title paired with a mono title count, on a hairline rule. */
export function LibrarySectionHeader({
  label,
  count,
  size = "regular",
}: LibrarySectionHeaderProps) {
  return (
    <div className="mb-4 flex items-baseline gap-4 border-b pb-3">
      <h2
        className={cn(
          "font-bold tracking-tight text-foreground",
          size === "display" ? "text-5xl leading-none" : "text-2xl",
        )}
      >
        {label}
      </h2>
      <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground/70">
        {m.library_section_count({ count: String(count) })}
      </span>
    </div>
  );
}
