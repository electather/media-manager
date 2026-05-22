import { memo } from "react";
import { Check, Plus } from "lucide-react";
import * as m from "@/paraglide/messages";
import {
  MediaCardAvailability,
  MediaCardClearLogo,
  MediaCardFrame,
  MediaCardImage,
  MediaCardLink,
  MediaCardQuickAction,
  MediaCardRoot,
  deriveMediaCardAvailability,
} from "@/shared/components/media-card";
import { buildMediaHref } from "@/shared/lib/media-id";
import { useIsInWatchlist } from "@/features/watchlist";
import { ROW_ASPECT } from "../../lib/home-feed-config";
import type { HomeMediaItem, RowKind } from "../../lib/types";
import { CardKindBadge } from "./card-kind-badge";
import { CardMeta } from "./card-meta";
import { CardProgress } from "./card-progress";

interface CardProps {
  item: HomeMediaItem;
  rowKind: RowKind;
  forceAspect?: "16/9" | "2/3";
  /** Called with the full item so the receiver can hydrate optimistic seeds. */
  onWatchlistToggle?: (item: HomeMediaItem) => void;
  /** Called with the item id; receivers should keep this reference stable across renders. */
  onClick?: (id: string) => void;
}

/**
 * Home-feed assembly of the shared `MediaCard` primitives. Threads the
 * home-side `RowKind → aspect` lookup, the `HomeMediaItem` projection of
 * facets / progress / kind, and the watchlist toggle copy.
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
  const showLogo = aspect === "16/9" && Boolean(item.clearLogo || item.clearLogoText);
  const imageSrc =
    aspect === "16/9" ? (item.backdrop ?? item.poster) : (item.poster ?? item.backdrop);
  const toggleLabel = isInWatchlist
    ? `${m.home_card_remove_watchlist()} ${item.title}`
    : `${m.home_card_add_watchlist()} ${item.title}`;
  const ToggleIcon = isInWatchlist ? Check : Plus;

  return (
    <MediaCardRoot aspect={aspect} data-testid="card">
      <MediaCardFrame>
        <MediaCardImage src={imageSrc} alt={item.title} aspect={aspect} />
        {showLogo && (
          <MediaCardClearLogo src={item.clearLogo} text={item.clearLogoText} alt={item.title} />
        )}
        <MediaCardAvailability
          state={deriveMediaCardAvailability(item)}
          className="pointer-events-none absolute inset-s-2 top-2"
        />
        <CardKindBadge item={item} />
        <CardProgress item={item} />
        <MediaCardQuickAction
          aria-label={toggleLabel}
          pressed={isInWatchlist}
          onPress={onWatchlistToggle ? () => onWatchlistToggle(item) : undefined}
        >
          <ToggleIcon aria-hidden="true" className="size-4" />
        </MediaCardQuickAction>
      </MediaCardFrame>
      <CardMeta item={item} />
      <MediaCardLink
        href={buildMediaHref(item.id) ?? "#"}
        aria-label={m.home_card_open_details({ title: item.title })}
        onPress={onClick ? () => onClick(item.id) : undefined}
      />
    </MediaCardRoot>
  );
});
