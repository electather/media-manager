import * as m from "@/paraglide/messages";
import type { HomeMediaItem } from "../../lib/types";

/** Bottom-edge progress overlay rendered on top of the card art. */
export function CardProgress({ item }: { item: HomeMediaItem }) {
  if (!item.progress || item.progress.total === 0) return null;
  const percent = Math.round((item.progress.watched / item.progress.total) * 100);
  return (
    <div
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={m.home_card_progress_watched({ percent: String(percent) })}
      className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-1 overflow-hidden bg-black/45"
    >
      <div className="h-full bg-progress-watched" style={{ width: `${percent}%` }} />
    </div>
  );
}
