import { clamp } from "es-toolkit";
import * as m from "@/paraglide/messages";
import { MediaCardProgress } from "@/shared/components/media-card";
import type { HomeMediaItem } from "../../lib/types";

/** Bottom-edge progress overlay rendered on top of the card art. */
export function CardProgress({ item }: { item: HomeMediaItem }) {
  if (!item.progress || item.progress.total === 0) return null;
  const percent = clamp(Math.round((item.progress.watched / item.progress.total) * 100), 0, 100);
  return (
    <MediaCardProgress
      percent={percent}
      ariaLabel={m.home_card_progress_watched({ percent: String(percent) })}
    />
  );
}
