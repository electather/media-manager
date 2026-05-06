import { MATCH_REASON_COPY } from "../../lib/home-feed-config";
import type { HomeMediaItem } from "../../lib/types";

/** Renders a one-line match-reason chip when the item has a recommendation rationale. */
export function CardMatchReason({ item }: { item: HomeMediaItem }) {
  const reason = item.matchReason;
  if (!reason) return null;
  const text = MATCH_REASON_COPY[reason.key](reason.params ?? {});
  return (
    <p className="mt-1 line-clamp-1 text-xs text-muted-foreground/85" aria-label={text}>
      {text}
    </p>
  );
}
