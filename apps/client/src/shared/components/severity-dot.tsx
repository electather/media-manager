import { cn } from "@/shared/lib/utils";

export type Severity = "error" | "warning" | "info";

const COLOR: Record<Severity, string> = {
  error: "bg-destructive",
  warning: "bg-primary",
  info: "bg-chart-2",
};

const GLOW: Record<Severity, string> = {
  error: "shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-destructive)_18%,transparent)]",
  warning: "shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-primary)_18%,transparent)]",
  info: "shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-chart-2)_18%,transparent)]",
};

interface Props {
  severity: Severity;
  /** Visual size; "sm" is for chip-adjacent dots, "md" for table cells. */
  size?: "sm" | "md";
  /** Adds a halo ring of the same hue — used in row affordances. */
  glow?: boolean;
  className?: string;
}

export function SeverityDot({ severity, size = "md", glow = false, className }: Props) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block rounded-full",
        size === "sm" ? "size-1.5" : "size-2",
        COLOR[severity],
        glow ? GLOW[severity] : undefined,
        className,
      )}
    />
  );
}

export const SEVERITY_TEXT: Record<Severity, string> = {
  error: "text-destructive",
  warning: "text-primary",
  info: "text-chart-2",
};

export const SEVERITY_BG: Record<Severity, string> = COLOR;
