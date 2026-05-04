import { useState } from "react";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import type { HomeMediaItem } from "../../lib/types";

interface CardActionsProps {
  item: HomeMediaItem;
  isInWatchlist?: boolean;
  onRequest?: () => void;
  onWatchlistToggle?: () => void;
}

/** Renders Request and Watchlist action buttons for a card. */
export function CardActions({
  item,
  isInWatchlist = false,
  onRequest,
  onWatchlistToggle,
}: CardActionsProps) {
  // TODO: lift requested state to the parent so it survives card remounts
  // (e.g. when a row reorders or filters change). Today the local state
  // resets whenever this component unmounts.
  const [isRequested, setIsRequested] = useState(false);

  const canRequest =
    item.availability &&
    !item.availability.hasAnyServerCopy &&
    item.availability.requestEligible &&
    !isRequested;

  function handleWatchlistToggle() {
    onWatchlistToggle?.();
  }

  function handleRequest() {
    setIsRequested(true);
    onRequest?.();
  }

  return (
    <div className="flex gap-2">
      {canRequest && (
        <Button
          size="sm"
          variant="outline"
          aria-label={`${m.home_card_request()} ${item.title}`}
          onClick={handleRequest}
        >
          {m.home_card_request()}
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        aria-label={
          isInWatchlist
            ? `${m.home_card_remove_watchlist()} ${item.title}`
            : `${m.home_card_add_watchlist()} ${item.title}`
        }
        onClick={handleWatchlistToggle}
      >
        {isInWatchlist ? m.home_card_remove_watchlist() : m.home_card_add_watchlist()}
      </Button>
    </div>
  );
}
