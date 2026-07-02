import { memo } from "react";
import { Check } from "lucide-react";
import * as m from "@/paraglide/messages";
import { MediaCardQuickAction } from "@/shared/components/media-card";
import { MediaRowCard } from "@/shared/components/media-row-card";
import { buildMediaHref } from "@/shared/lib/media-id";
import type { CompactMediaItem } from "@nama/shared/media";
import { useToggleWatchlist } from "../hooks";

interface WatchlistCardProps {
  item: CompactMediaItem;
  forceAspect?: "16/9" | "2/3";
  onPeek: (id: string) => void;
}

/**
 * Watchlist card. Composes the shared `MediaRowCard` with the watchlist-specific
 * remove quick-action. Items on the watchlist are on it by definition, so the
 * action always renders as "in watchlist" and a press removes the item via the
 * optimistic mutation.
 */
export const WatchlistCard = memo(function WatchlistCard({
  item,
  forceAspect = "2/3",
  onPeek,
}: WatchlistCardProps) {
  const toggle = useToggleWatchlist();
  const variant = forceAspect === "16/9" ? "rail" : "grid";
  const kindLabel = m.media_kind({ kind: item.mediaType });
  const removeLabel = m.watchlist_remove_aria({ title: item.title });

  return (
    <MediaRowCard
      item={item}
      variant={variant}
      href={buildMediaHref(item.id) ?? "#"}
      openLabel={item.title}
      kindLabel={kindLabel}
      onOpen={() => onPeek(item.id)}
      action={
        <MediaCardQuickAction aria-label={removeLabel} pressed onPress={() => toggle(item)}>
          <Check aria-hidden="true" />
        </MediaCardQuickAction>
      }
    />
  );
});
