import { Check, Film, Tv } from "lucide-react";
import * as m from "@/paraglide/messages";
import {
  MediaCardAvailability,
  MediaCardBadge,
  MediaCardClearLogo,
  MediaCardFrame,
  MediaCardImage,
  MediaCardLink,
  MediaCardMeta,
  MediaCardProgress,
  MediaCardQuickAction,
  MediaCardRoot,
  MediaCardSubtitle,
  MediaCardTitle,
  deriveMediaCardAvailability,
} from "@/shared/components/media-card";
import { buildMediaHref } from "@/shared/lib/media-id";
import type { CompactMediaItem } from "@ent-mcp/shared/media";
import { useToggleWatchlist } from "../hooks";

interface WatchlistCardProps {
  item: CompactMediaItem;
  forceAspect?: "16/9" | "2/3";
  onPeek: (id: string) => void;
}

/**
 * Watchlist-side assembly of the shared `MediaCard` primitives. Items shown
 * on the watchlist are on the watchlist by definition, so the quick action
 * always reads as "in watchlist" and a click removes the row via the
 * optimistic mutation.
 */
// The branch count is the irreducible per-overlay presentational fan-out (image, clear-logo, availability, badge, progress, action); behaviorally exercised via the section render tests.
// fallow-ignore-next-line complexity
export function WatchlistCard({ item, forceAspect = "2/3", onPeek }: WatchlistCardProps) {
  const toggle = useToggleWatchlist();
  const aspect = forceAspect;
  const isWide = aspect === "16/9";
  const imageSrc = isWide ? (item.backdrop ?? item.poster) : (item.poster ?? item.backdrop);
  const isMovie = item.mediaType === "movie";
  const KindIcon = isMovie ? Film : Tv;
  const kindLabel = m.watchlist_kind({ kind: item.mediaType });
  const removeLabel = `${m.watchlist_toggle_remove()} ${item.title}`;
  const progressPercent =
    item.progress && item.progress.total > 0
      ? Math.round((item.progress.watched / item.progress.total) * 100)
      : null;

  return (
    <MediaCardRoot aspect={aspect}>
      <MediaCardFrame>
        <MediaCardImage src={imageSrc} alt={item.title} aspect={aspect} />
        {/* #516: only render the clear-logo wordmark when the item actually
            carries a logo — a logo-less row no longer shows its title as a
            faux wordmark (the old `text={item.title}` fallback). */}
        {isWide && item.clearLogo ? (
          <MediaCardClearLogo src={item.clearLogo} alt={item.title} />
        ) : null}
        <MediaCardAvailability
          state={deriveMediaCardAvailability(item)}
          className="pointer-events-none absolute inset-s-2 top-2"
        />
        <MediaCardBadge position="top-end" title={kindLabel} aria-label={kindLabel}>
          <KindIcon aria-hidden="true" className="size-3.5" />
        </MediaCardBadge>
        {progressPercent != null ? (
          <MediaCardProgress percent={progressPercent} ariaLabel={`${progressPercent}%`} />
        ) : null}
        <MediaCardQuickAction aria-label={removeLabel} pressed onPress={() => toggle(item)}>
          <Check aria-hidden="true" />
        </MediaCardQuickAction>
      </MediaCardFrame>
      {isWide ? null : (
        <MediaCardMeta>
          <MediaCardTitle>{item.title}</MediaCardTitle>
          {item.year ? <MediaCardSubtitle>{item.year}</MediaCardSubtitle> : null}
        </MediaCardMeta>
      )}
      <MediaCardLink
        href={buildMediaHref(item.id) ?? "#"}
        aria-label={item.title}
        onPress={() => onPeek(item.id)}
      />
    </MediaCardRoot>
  );
}
