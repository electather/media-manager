import { memo } from "react";
import { Check, Plus } from "lucide-react";
import * as m from "@/paraglide/messages";
import { MediaCardQuickAction } from "@/shared/components/media-card";
import { MediaRowCard } from "@/shared/components/media-row-card";
import { buildMediaHref } from "@/shared/lib/media-id";
import type { RowKind } from "@nama/shared/home";
import { useIsInWatchlist } from "@/features/watchlist";
import { ROW_ASPECT } from "../../lib/home-feed-config";
import type { HomeMediaItem, RowAspect } from "../../lib/types";
import { CardMeta } from "./card-meta";

interface CardProps {
  item: HomeMediaItem;
  rowKind: RowKind;
  forceAspect?: RowAspect;
  /** Called with the full item so the receiver can hydrate optimistic seeds. */
  onWatchlistToggle?: (item: HomeMediaItem) => void;
  /** Called with the item id; receivers should keep this reference stable across renders. */
  onClick?: (id: string) => void;
}

/** Localized "X% watched" aria-label for the shared card's progress overlay. */
const homeProgressLabel = (percent: number) =>
  m.home_card_progress_watched({ percent: String(percent) });

/**
 * Home-feed card (design §B3): shared `MediaRowCard` plus watchlist quick-action and `CardMeta` footer.
 * `memo`'d against page-append re-renders — callers MUST pass stable handlers (not per-render closures) for the win.
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
    ? m.home_card_remove_watchlist({ title: item.title })
    : m.home_card_add_watchlist({ title: item.title });
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
      onOpen={() => onClick?.(item.id)}
      action={
        <MediaCardQuickAction
          aria-label={toggleLabel}
          pressed={isInWatchlist}
          onPress={() => onWatchlistToggle?.(item)}
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
