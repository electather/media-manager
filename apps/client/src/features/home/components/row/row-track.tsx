import { ScrollRowSkeleton, ScrollRowTrack } from "@/shared/components/scroll-row";
import type { RowKind } from "@nama/shared/home";
import { Card } from "../card/index";
import { isErrorSentinel, type TrackEntry } from "../../lib/track-entries";
import type { HomeMediaItem, RowAspect } from "../../lib/types";
import { RowErrorInlineCard } from "./row-error";

const SKELETON_COUNT = 5;

/** Placeholder track shown on first load before any item resolves. */
export function RowSkeletonTrack({ heading, aspect }: { heading: string; aspect: RowAspect }) {
  return (
    <ScrollRowTrack aria-label={heading} className="scroll-px-8 pb-3">
      {Array.from({ length: SKELETON_COUNT }, (_, i) => (
        <ScrollRowSkeleton key={`skeleton-${i}`} aspect={aspect} />
      ))}
    </ScrollRowTrack>
  );
}

interface RowItemTrackProps {
  heading: string;
  entries: TrackEntry[];
  isBackdrop: boolean;
  rowKind: RowKind;
  /** Non-null only when a pagination retry is pending (drives the trailing sentinel card). */
  error: Error | null;
  isFetchingNextPage: boolean;
  onRangeChange: (range: { startIndex: number; endIndex: number }) => void;
  onRetryPage: () => void;
  onWatchlistToggle?: (item: HomeMediaItem) => void;
  onCardClick?: (id: string) => void;
}

/** Virtualized track of cards, with the trailing pagination-error card as the last slot. */
export function RowItemTrack({
  heading,
  entries,
  isBackdrop,
  rowKind,
  error,
  isFetchingNextPage,
  onRangeChange,
  onRetryPage,
  onWatchlistToggle,
  onCardClick,
}: RowItemTrackProps) {
  return (
    <ScrollRowTrack
      virtualize
      aria-label={heading}
      className="scroll-px-8 pb-3"
      items={entries}
      getKey={(entry, i) => (isErrorSentinel(entry) ? `error-sentinel-${i}` : entry.id)}
      estimateItemWidth={isBackdrop ? 320 : 200}
      onRangeChange={onRangeChange}
      renderItem={(entry) =>
        isErrorSentinel(entry) ? (
          error ? (
            <RowErrorInlineCard
              error={error}
              onRetry={onRetryPage}
              isRetrying={isFetchingNextPage}
            />
          ) : null
        ) : (
          <Card
            item={entry}
            rowKind={rowKind}
            onWatchlistToggle={onWatchlistToggle}
            onClick={onCardClick}
          />
        )
      }
    />
  );
}
