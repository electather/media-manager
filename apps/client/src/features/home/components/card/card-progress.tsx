import type { HomeMediaItem } from "../../lib/types";

interface CardProgressProps {
  item: HomeMediaItem;
}

/** Renders a progress bar when the item has partial watch progress recorded. */
export function CardProgress({ item }: CardProgressProps) {
  if (!item.progress) return null;

  const percent = Math.round((item.progress.watched / item.progress.total) * 100);

  return (
    <div
      className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${percent}% watched`}
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
    </div>
  );
}
