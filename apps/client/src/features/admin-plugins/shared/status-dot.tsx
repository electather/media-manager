import { cn } from "@/shared/lib/utils";

export type StatusTone = "ok" | "warn" | "error" | "disabled";

const TONE_CLASS: Record<StatusTone, string> = {
  ok: "bg-emerald-500 shadow-[0_0_0_3px_oklch(0.7_0.18_145_/_0.18)]",
  warn: "bg-amber-500 shadow-[0_0_0_3px_oklch(0.78_0.17_75_/_0.18)]",
  error: "bg-destructive shadow-[0_0_0_3px_oklch(from_var(--destructive)_l_c_h_/_0.18)]",
  disabled: "bg-muted-foreground/60 shadow-[0_0_0_3px_oklch(0.5_0.01_260_/_0.18)]",
};

interface StatusDotProps {
  tone?: StatusTone;
  size?: number;
  className?: string;
}

export function StatusDot({ tone = "ok", size = 8, className }: StatusDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block shrink-0 rounded-full", TONE_CLASS[tone], className)}
      style={{ width: size, height: size }}
    />
  );
}
