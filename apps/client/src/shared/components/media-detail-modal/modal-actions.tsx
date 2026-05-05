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

export function ModalActions({ item, inWatchlist, onToggleWatchlist }: Props) {
  const [requested, setRequested] = useState(item.status === "requested");
  return (
    <div className="flex flex-wrap gap-2 px-6 sm:px-10">
      {requested ? (
        <Button size="lg" variant="secondary" disabled className="gap-2">
          <Check aria-hidden="true" className="size-4" />
          {m.home_card_requested()}
        </Button>
      ) : (
        <Button size="lg" className="gap-2" onClick={() => setRequested(true)}>
          <Play aria-hidden="true" className="size-4 fill-current" />
          {m.home_detail_request()}
        </Button>
      )}
      <Button
        size="lg"
        variant="outline"
        className="gap-2"
        aria-pressed={inWatchlist}
        onClick={onToggleWatchlist}
      >
        <Bookmark aria-hidden="true" className={inWatchlist ? "size-4 fill-current" : "size-4"} />
        {inWatchlist ? m.home_detail_watchlist_remove() : m.home_detail_watchlist_add()}
      </Button>
      <Button size="lg" variant="ghost" className="gap-2" type="button">
        <Film aria-hidden="true" className="size-4" />
        {m.home_detail_trailer()}
      </Button>
    </div>
  );
}
