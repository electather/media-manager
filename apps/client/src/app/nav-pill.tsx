import type { CSSProperties } from "react";
import { cn } from "@/shared/lib/utils";

type NavPillProps = {
  className?: string;
  style?: CSSProperties;
};

export function NavPill({ className, style }: NavPillProps) {
  return (
    <span
      aria-hidden="true"
      data-testid="nav-active-pill"
      className={cn(
        "pointer-events-none absolute border border-foreground/10 bg-foreground/10",
        className,
      )}
      style={style}
    />
  );
}
