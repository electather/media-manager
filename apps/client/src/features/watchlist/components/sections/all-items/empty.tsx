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
import type { MoodId, WatchlistBucket } from "@nama/shared/watchlist";
import { EmptyState } from "@/shared/components/empty-state";
import { MOOD_REGISTRY } from "../../../lib/mood-registry";

interface BucketCopy {
  icon: LucideIcon;
  title: () => string;
  description: () => string;
}

const BUCKET_ICON: Record<WatchlistBucket, LucideIcon> = {
  ready: PlayCircleIcon,
  "in-progress": PauseCircleIcon,
  awaiting: ClockIcon,
  unavailable: PackageOpenIcon,
  upcoming: CalendarIcon,
};

// Title / body copy is resolved through the keyed `watchlist_empty_title`
// / `watchlist_empty_body` ICU variants (selector `bucket`); only the
// per-bucket glyph stays mapped here.
const BUCKET_COPY: Record<WatchlistBucket, BucketCopy> = Object.fromEntries(
  (Object.keys(BUCKET_ICON) as WatchlistBucket[]).map((bucket): [WatchlistBucket, BucketCopy] => [
    bucket,
    {
      icon: BUCKET_ICON[bucket],
      title: () => m.watchlist_empty_title({ bucket }),
      description: () => m.watchlist_empty_body({ bucket }),
    },
  ]),
) as Record<WatchlistBucket, BucketCopy>;

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
