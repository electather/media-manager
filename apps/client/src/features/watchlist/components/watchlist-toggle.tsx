import { useCallback } from "react";
import { Heart } from "lucide-react";
import * as m from "@/paraglide/messages";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import type { WatchlistUserSource, WatchlistItem } from "@ent-mcp/shared/watchlist";
import { Button } from "@/shared/ui/button";
import { useIsInWatchlist } from "../hooks/use-is-in-watchlist";
import { useAddToWatchlist } from "../hooks/use-add-to-watchlist";
import { useRemoveFromWatchlist } from "../hooks/use-remove-from-watchlist";

interface WatchlistToggleProps {
  item: CompactMediaItem;
  /** Defaults to "manual" — the public source enum excludes "plugin". */
  source?: WatchlistUserSource;
  /** Optional override label / variant. */
  size?: "default" | "sm" | "icon";
}

/**
 * Toggle button that flips between add and remove based on the cached
 * watchlist state. Cross-feature consumers (search result row, detail modal)
 * compose `item` from the same `CompactMediaItem` shape the home feed serves.
 */
export function WatchlistToggle({ item, source = "manual", size = "sm" }: WatchlistToggleProps) {
  const inWatchlist = useIsInWatchlist(item.id);
  const add = useAddToWatchlist();
  const remove = useRemoveFromWatchlist();
  const pending = add.isPending || remove.isPending;

  const onClick = useCallback(() => {
    if (inWatchlist) {
      remove.mutate({ tmdbId: item.tmdbId, mediaType: item.mediaType });
      return;
    }
    const seed: Partial<WatchlistItem> = {
      id: item.id,
      tmdbId: item.tmdbId,
      mediaType: item.mediaType,
      title: item.title,
    };
    if (item.year != null) seed.year = item.year;
    if (item.poster) seed.poster = item.poster;
    if (item.backdrop) seed.backdrop = item.backdrop;
    if (item.genres && item.genres.length > 0) seed.genres = item.genres;
    add.mutate({
      request: { tmdbId: item.tmdbId, mediaType: item.mediaType, source },
      seed,
    });
  }, [add, remove, inWatchlist, item, source]);

  const label = inWatchlist ? m.watchlist_toggle_remove() : m.watchlist_toggle_add();
  return (
    <Button
      type="button"
      size={size}
      variant={inWatchlist ? "secondary" : "outline"}
      aria-pressed={inWatchlist}
      aria-label={label}
      disabled={pending}
      onClick={onClick}
    >
      <Heart aria-hidden="true" className={inWatchlist ? "fill-current" : ""} />
      <span className="ms-1">{label}</span>
    </Button>
  );
}
