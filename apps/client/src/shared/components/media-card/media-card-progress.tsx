import { cn } from "@/shared/lib/utils";

type Props = {
  percent: number;
  ariaLabel: string;
  className?: string;
};

/**
 * Bottom-edge progress strip overlaid on card art. The track is dim and the
 * fill blends via `mix-blend-overlay` so it reads as part of the image
 * instead of a flat bar.
 */
export function MediaCardProgress({ percent, ariaLabel, className }: Props) {
  return (
    <div
      data-slot="media-card-progress"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 z-1 h-1 overflow-hidden bg-background/20",
        className,
      )}
    >
      <div
        className="h-full rounded-e-sm bg-foreground/55 mix-blend-overlay"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
