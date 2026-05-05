import { useState } from "react";
import { Bookmark, Check, Film, Play } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import type { MediaDetailItem } from "./types";

type Props = {
  item: MediaDetailItem;
  inWatchlist: boolean;
  onToggleWatchlist: () => void;
};

/**
 * Treat "#" trailerUrl as no trailer (the mock data uses it as a placeholder)
 * so the button stays disabled rather than navigating to the same page.
 */
function hasTrailer(url: string | undefined): url is string {
  return Boolean(url) && url !== "#";
}

export function ModalActions({ item, inWatchlist, onToggleWatchlist }: Props) {
  const [requested, setRequested] = useState(item.status === "requested");
  const trailerOk = hasTrailer(item.trailerUrl);

  function openTrailer() {
    if (!trailerOk) return;
    window.open(item.trailerUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex flex-wrap gap-2 px-6 sm:px-10">
      {requested ? (
        <Button size="lg" variant="secondary" disabled>
          <Check aria-hidden="true" />
          {m.home_card_requested()}
        </Button>
      ) : (
        <Button size="lg" onClick={() => setRequested(true)}>
          <Play aria-hidden="true" className="fill-current" />
          {m.home_detail_request()}
        </Button>
      )}
      <Button
        size="lg"
        variant="outline"
        aria-pressed={inWatchlist}
        onClick={onToggleWatchlist}
        className="bg-card/40 supports-backdrop-filter:bg-card/30 supports-backdrop-filter:backdrop-blur"
      >
        <Bookmark aria-hidden="true" className={inWatchlist ? "fill-current" : undefined} />
        {inWatchlist ? m.home_detail_watchlist_remove() : m.home_detail_watchlist_add()}
      </Button>
      <Button
        size="lg"
        variant="ghost"
        type="button"
        onClick={openTrailer}
        disabled={!trailerOk}
        className="bg-card/40 supports-backdrop-filter:bg-card/30 supports-backdrop-filter:backdrop-blur"
      >
        <Film aria-hidden="true" />
        {m.home_detail_trailer()}
      </Button>
    </div>
  );
}
