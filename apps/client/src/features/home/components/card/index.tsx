import { memo } from "react";
import { Check, Plus } from "lucide-react";
import * as m from "@/paraglide/messages";
import { MediaCardQuickAction } from "@/shared/components/media-card";
import { MediaRowCard } from "@/shared/components/media-row-card";
import { buildMediaHref } from "@/shared/lib/media-id";
import { useIsInWatchlist } from "@/features/watchlist";
import { ROW_ASPECT } from "../../lib/home-feed-config";
import type { HomeMediaItem, RowKind } from "../../lib/types";
import { CardMeta } from "./card-meta";

interface CardProps {
  item: HomeMediaItem;
  rowKind: RowKind;
  forceAspect?: "16/9" | "2/3";
  /** Called with the full item so the receiver can hydrate optimistic seeds. */
  onWatchlistToggle?: (item: HomeMediaItem) => void;
  /** Called with the item id; receivers should keep this reference stable across renders. */
  onClick?: (id: string) => void;
}

/** Localized "X% watched" aria-label for the shared card's progress overlay. */
const homeProgressLabel = (percent: number) =>
  m.home_card_progress_watched({ percent: String(percent) });

/**
 * Home-feed card. Renders the shared `MediaRowCard` (design §B3) with the
 * home-specific quick-action (watchlist toggle) and footer (`CardMeta`:
 * match-reason chip + treatment-aware meta) slotted in; the shared card owns
 * the framed art, clear-logo, availability, kind badge, and progress overlays.
 *
 * Wrapped in `memo` so paginated rows do not re-render every existing card
 * on each page-append. Callers must pass stable handlers (not per-render
 * closures) to realise the win.
 */
export const Card = memo(function Card({
  item,
  rowKind,
  forceAspect,
  onWatchlistToggle,
  onClick,
}: CardProps) {
  const isInWatchlist = useIsInWatchlist(item.id);
  const aspect = forceAspect ?? ROW_ASPECT[rowKind];
  const variant = aspect === "16/9" ? "rail" : "grid";
  const toggleLabel = isInWatchlist
    ? `${m.home_card_remove_watchlist()} ${item.title}`
    : `${m.home_card_add_watchlist()} ${item.title}`;
  const ToggleIcon = isInWatchlist ? Check : Plus;
  const kindLabel = m.media_kind({ kind: item.mediaType });

  return (
    <MediaRowCard
      item={item}
      variant={variant}
      href={buildMediaHref(item.id) ?? "#"}
      openLabel={m.home_card_open_details({ title: item.title })}
      kindLabel={kindLabel}
      progressLabel={homeProgressLabel}
      onOpen={onClick ? () => onClick(item.id) : undefined}
      action={
        <MediaCardQuickAction
          aria-label={toggleLabel}
          pressed={isInWatchlist}
          onPress={onWatchlistToggle ? () => onWatchlistToggle(item) : undefined}
        >
          <span
            key={isInWatchlist ? "in" : "out"}
            className="inline-flex motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-50 motion-safe:duration-300 motion-safe:ease-[cubic-bezier(0.34,1.56,0.64,1)]"
          >
            <ToggleIcon aria-hidden="true" className="size-4" />
          </span>
        </MediaCardQuickAction>
      }
      meta={<CardMeta item={item} />}
    />
  );
});
