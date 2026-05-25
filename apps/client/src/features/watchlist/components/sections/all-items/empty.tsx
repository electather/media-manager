import {
  BookmarkIcon,
  CalendarIcon,
  ClockIcon,
  PackageOpenIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  type LucideIcon,
} from "lucide-react";

import * as m from "@/paraglide/messages";
import type { MoodId, WatchlistBucket } from "@ent-mcp/shared/watchlist";
import { EmptyState } from "@/shared/components/empty-state";
import { MOOD_REGISTRY } from "../../../lib/mood-registry";

interface BucketCopy {
  icon: LucideIcon;
  title: () => string;
  description: () => string;
}

const BUCKET_COPY: Record<WatchlistBucket, BucketCopy> = {
  ready: {
    icon: PlayCircleIcon,
    title: m.watchlist_empty_ready_title,
    description: m.watchlist_empty_ready_description,
  },
  "in-progress": {
    icon: PauseCircleIcon,
    title: m.watchlist_empty_in_progress_title,
    description: m.watchlist_empty_in_progress_description,
  },
  awaiting: {
    icon: ClockIcon,
    title: m.watchlist_empty_awaiting_title,
    description: m.watchlist_empty_awaiting_description,
  },
  unavailable: {
    icon: PackageOpenIcon,
    title: m.watchlist_empty_unavailable_title,
    description: m.watchlist_empty_unavailable_description,
  },
  upcoming: {
    icon: CalendarIcon,
    title: m.watchlist_empty_upcoming_title,
    description: m.watchlist_empty_upcoming_description,
  },
};

interface WatchlistEmptyProps {
  bucket?: WatchlistBucket;
  mood?: MoodId;
}

/**
 * Bucket / mood-aware empty state for the watchlist flat + mood grids
 * (V.WL11). Composes the shared `<EmptyState>` primitive with paraglide copy
 * and a per-axis lucide glyph.
 */
export function WatchlistEmpty({ bucket, mood }: WatchlistEmptyProps) {
  if (mood) {
    const moodLabel = MOOD_REGISTRY[mood].label();
    return (
      <EmptyState
        icon={<BookmarkIcon className="size-5" aria-hidden="true" />}
        title={m.watchlist_empty_mood_title({ moodLabel })}
        description={m.watchlist_empty_mood_description()}
      />
    );
  }
  // Routes mount `AllItems` with one of `bucket` / `mood`; if neither is set
  // we fail loud rather than render bucket-specific copy that lies about the
  // active filter.
  if (!bucket) throw new Error("WatchlistEmpty requires either `bucket` or `mood`");
  const copy = BUCKET_COPY[bucket];
  const Icon = copy.icon;
  return (
    <EmptyState
      icon={<Icon className="size-5" aria-hidden="true" />}
      title={copy.title()}
      description={copy.description()}
    />
  );
}
