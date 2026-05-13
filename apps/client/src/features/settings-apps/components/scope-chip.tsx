import { cn } from "@/shared/lib/utils";

interface ScopeChipProps {
  /** Scope string of the form `<resource>:read` or `<resource>:write`. */
  scope: string;
  className?: string;
}

export function ScopeChip({ scope, className }: ScopeChipProps) {
  const writes = scope.endsWith(":write");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10.5px] tracking-wider",
        writes
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border bg-muted text-muted-foreground",
        className,
      )}
    >
      {writes ? <span aria-hidden="true" className="size-1 rounded-full bg-primary" /> : null}
      {scope}
    </span>
  );
}
