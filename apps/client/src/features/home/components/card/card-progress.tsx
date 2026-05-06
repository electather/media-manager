import { clamp } from "es-toolkit";
import * as m from "@/paraglide/messages";
import type { HomeMediaItem } from "../../lib/types";
import { ProgressOverlay } from "../progress-overlay";

/** Bottom-edge progress overlay rendered on top of the card art. */
export function CardProgress({ item }: { item: HomeMediaItem }) {
  if (!item.progress || item.progress.total === 0) return null;
  const percent = clamp(Math.round((item.progress.watched / item.progress.total) * 100), 0, 100);
  return (
    <ProgressOverlay
      percent={percent}
      ariaLabel={m.home_card_progress_watched({ percent: String(percent) })}
    />
  );
}
