import { cn } from "@/shared/lib/utils";

type ProgressBarProps = {
  ratio: number;
  className?: string;
};

export function ProgressBar({ ratio, className }: ProgressBarProps) {
  const pct = Math.round(clamp01(ratio) * 100);
  return (
    <div
      aria-hidden="true"
      className={cn("absolute right-0 bottom-0 left-0 h-1 bg-black/45", className)}
    >
      <div className="h-full bg-progress-watched" style={{ width: `${pct}%` }} />
    </div>
  );
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
