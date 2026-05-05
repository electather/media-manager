import { Check, Plus } from "lucide-react";
import type { MouseEvent } from "react";
import * as m from "@/paraglide/messages";
import type { HomeMediaItem } from "../../lib/types";

type Props = {
  item: HomeMediaItem;
  isInWatchlist: boolean;
  onToggle?: () => void;
};

/** Hover-revealed watchlist toggle that sits above the card click overlay. */
export function CardQuickAction({ item, isInWatchlist, onToggle }: Props) {
  const Icon = isInWatchlist ? Check : Plus;
  const label = isInWatchlist
    ? `${m.home_card_remove_watchlist()} ${item.title}`
    : `${m.home_card_add_watchlist()} ${item.title}`;
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    onToggle?.();
  }
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      aria-pressed={isInWatchlist}
      className="absolute end-2 bottom-2 z-30 inline-flex size-8 items-center justify-center rounded-full border border-border bg-background/60 text-foreground opacity-0 backdrop-blur-md transition-all duration-200 hover:bg-background/85 group-focus-within:opacity-100 group-hover:opacity-100"
    >
      <Icon aria-hidden="true" className="size-4" />
    </button>
  );
}
