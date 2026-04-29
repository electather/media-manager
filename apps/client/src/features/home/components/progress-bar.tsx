import { cn } from "@/shared/lib/utils";

interface ProgressBarProps {
  watched: number;
  total: number;
  className?: string;
}

export function ProgressBar({ watched, total, className }: ProgressBarProps) {
  if (total <= 0) return null;
  const pct = Math.min(100, Math.max(0, Math.round((watched / total) * 100)));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn(
        "absolute inset-x-0 bottom-0 h-1 overflow-hidden rounded-b-md bg-black/40",
        className,
      )}
    >
      <div
        className="h-full bg-[var(--color-progress-watched,theme(colors.red.500))]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
