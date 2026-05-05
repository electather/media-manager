import * as m from "@/paraglide/messages";
import { ROW_ASPECT } from "../../lib/home-feed-config";
import { deriveCardState } from "../../lib/card-state";
import type { HomeMediaItem, RowKind } from "../../lib/types";
import { CardAvailability } from "./card-availability";
import { CardClearLogo } from "./card-clear-logo";
import { CardImage } from "./card-image";
import { CardKindBadge } from "./card-kind-badge";
import { CardMeta } from "./card-meta";
import { CardProgress } from "./card-progress";
import { CardQuickAction } from "./card-quick-action";

interface CardProps {
  item: HomeMediaItem;
  rowKind: RowKind;
  forceAspect?: "16/9" | "2/3";
  isInWatchlist?: boolean;
  onWatchlistToggle?: () => void;
  onClick?: () => void;
}

/**
 * Orchestrates the card layers. Outermost <article> is the focusable click
 * target via a transparent absolute-positioned overlay so quick-action and
 * future hot-spots can sit above it without nesting interactive controls.
 */
export function Card({
  item,
  rowKind,
  forceAspect,
  isInWatchlist = false,
  onWatchlistToggle,
  onClick,
}: CardProps) {
  const aspect = forceAspect ?? ROW_ASPECT[rowKind];
  const state = deriveCardState(item);
  const showLogo = aspect === "16/9" && Boolean(item.clearLogoText);

  return (
    <article data-testid="card" className="group relative isolate flex w-full flex-col">
      <div className="relative">
        <CardImage item={item} aspect={aspect} />
        {showLogo ? <CardClearLogo text={item.clearLogoText!} /> : null}
        <CardAvailability state={state} />
        <CardKindBadge item={item} />
        <CardProgress item={item} />
        <CardQuickAction item={item} isInWatchlist={isInWatchlist} onToggle={onWatchlistToggle} />
      </div>
      <CardMeta item={item} />
      <button
        type="button"
        onClick={onClick}
        aria-label={`${m.home_card_open_details()} ${item.title}`}
        className="absolute inset-0 z-10 cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </article>
  );
}
