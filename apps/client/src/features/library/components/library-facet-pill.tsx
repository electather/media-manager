import { cn } from "@/shared/lib/utils";

interface LibraryFacetPillProps {
  label: string;
  count?: number;
  active: boolean;
  onToggle: () => void;
}

/** A single toggleable facet option inside the filter popover. */
export function LibraryFacetPill({ label, count, active, onToggle }: LibraryFacetPillProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:border-input hover:text-foreground",
      )}
    >
      <span>{label}</span>
      {count != null ? (
        <span
          className={cn(
            "font-mono text-[0.625rem] tabular-nums",
            active ? "text-primary-foreground/70" : "text-muted-foreground/60",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
