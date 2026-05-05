import { useState } from "react";
import { Bookmark, Check, Eye, Film, MoreHorizontal, Play } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import type { HomeMediaItem } from "@/features/home/lib/types";

type Props = {
  item: HomeMediaItem;
  inWatchlist: boolean;
  onToggleWatchlist: () => void;
};

function isPlayable(url: string | undefined): url is string {
  return Boolean(url) && url !== "#";
}

export function DetailHeroActions({ item, inWatchlist, onToggleWatchlist }: Props) {
  const [requested, setRequested] = useState(item.status === "requested");
  const [watched, setWatched] = useState(false);
  const trailerUrl = item.trailerUrl;
  const trailerPlayable = isPlayable(trailerUrl);

  function openTrailer() {
    if (!trailerPlayable) return;
    window.open(trailerUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
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
        onClick={openTrailer}
        disabled={!trailerPlayable}
      >
        <Film aria-hidden="true" className="size-4" />
        {m.home_detail_trailer()}
      </Button>
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
      <Button
        size="lg"
        variant="outline"
        className="gap-2"
        aria-pressed={watched}
        onClick={() => setWatched((prev) => !prev)}
      >
        {watched ? (
          <Check aria-hidden="true" className="size-4" />
        ) : (
          <Eye aria-hidden="true" className="size-4" />
        )}
        {watched ? m.media_detail_watched() : m.media_detail_mark_watched()}
      </Button>
      <Button
        size="icon-lg"
        variant="outline"
        aria-label={m.media_detail_more_options()}
        type="button"
      >
        <MoreHorizontal aria-hidden="true" className="size-4" />
      </Button>
    </div>
  );
}
