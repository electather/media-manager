import { memo } from "react";
import * as m from "@/paraglide/messages";
import { MediaRowCard } from "@/shared/components/media-row-card";
import { buildMediaHref } from "@/shared/lib/media-id";
import { kindLabel } from "../lib/labels";
import type { LibraryItem } from "../lib/types";

const progressLabel = (percent: number) => m.library_card_progress({ percent: String(percent) });

/**
 * One library tile. Reuses the shared `MediaRowCard` (grid variant: 2/3 poster
 * with a title + year footer) and links to the existing detail route, so the
 * library inherits the exact card treatment the home feed and watchlist use.
 *
 * `memo` because the lenses render many of these; the props are stable per item.
 */
export const LibraryCard = memo(function LibraryCard({ item }: { item: LibraryItem }) {
  return (
    <MediaRowCard
      item={item}
      variant="grid"
      href={buildMediaHref(item.id) ?? undefined}
      openLabel={m.library_card_open({ title: item.title })}
      kindLabel={kindLabel(item.mediaType)}
      progressLabel={progressLabel}
    />
  );
});
