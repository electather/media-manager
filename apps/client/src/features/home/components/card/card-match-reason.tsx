import { MATCH_REASON_COPY } from "../../lib/home-feed-config";
import type { HomeMediaItem } from "../../lib/types";

interface CardMatchReasonProps {
  item: HomeMediaItem;
}

/** Renders a match-reason chip when the item has a recommendation rationale. */
export function CardMatchReason({ item }: CardMatchReasonProps) {
  if (!item.matchReasonKey) return null;

  const text = MATCH_REASON_COPY[item.matchReasonKey](item.matchReasonParams ?? {});

  return (
    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground" aria-label={text}>
      {text}
    </p>
  );
}
