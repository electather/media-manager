import { Bookmark, Film, Play } from "lucide-react";
import * as m from "@/paraglide/messages";
import { MovieRequestAction } from "@/features/request-flow";
import { Button } from "@/shared/ui/button";
import type { MediaDetailItem } from "./types";

type Props = {
  item: MediaDetailItem;
  inWatchlist: boolean;
  onToggleWatchlist: () => void;
};

function hasTrailer(url: string | undefined): url is string {
  return Boolean(url) && url !== "#";
}

export function ModalActions({ item, inWatchlist, onToggleWatchlist }: Props) {
  const trailerOk = hasTrailer(item.trailerUrl);

  function openTrailer() {
    if (!trailerOk) return;
    window.open(item.trailerUrl, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex flex-wrap gap-2 px-6 sm:px-10">
      <PrimaryAction item={item} />
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

function PrimaryAction({ item }: { item: MediaDetailItem }) {
  // TV shows handle requests per-season inside ModalSeasons — no top-level request button.
  if (item.mediaType === "tv") return null;

  if (item.status === "available") {
    // Playback is not yet wired; disabling prevents a silent no-op while
    // keeping the button visible so users understand the intent.
    return (
      <Button size="lg" disabled>
        <Play aria-hidden="true" className="fill-current" />
        {m.home_detail_watch()}
      </Button>
    );
  }

  return <MovieRequestAction itemId={item.id} itemTitle={item.title} initialStatus={item.status} />;
}
