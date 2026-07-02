import type { CSSProperties, ReactNode } from "react";
import {
  SectionHead,
  SectionHeadActions,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import {
  ScrollRow,
  ScrollRowNextButton,
  ScrollRowPrevButton,
  ScrollRowSkeleton,
  ScrollRowTrack,
  ScrollRowViewport,
} from "@/shared/components/scroll-row";
import type { RowKind } from "@nama/shared/home";
import { Card } from "../card/index";
import type { HomeMediaItem, RowAspect } from "../../lib/types";

const SKELETON_COUNT = 5;

interface RowScrollContainerProps {
  heading: string;
  eyebrow?: string;
  prevLabel: string;
  nextLabel: string;
  revalidationKey: string;
  cardVars: CSSProperties;
  children: ReactNode;
}

/** Full row shell: scroll container + section head + viewport. Keeps RowImpl branch-free. */
export function RowScrollContainer({
  heading,
  eyebrow,
  prevLabel,
  nextLabel,
  revalidationKey,
  cardVars,
  children,
}: RowScrollContainerProps) {
  return (
    <ScrollRow revalidationKey={revalidationKey} className="mb-8">
      <SectionHead>
        <SectionHeadHeading>
          {eyebrow ? <SectionHeadEyebrow>{eyebrow}</SectionHeadEyebrow> : null}
          <SectionHeadTitle>{heading}</SectionHeadTitle>
        </SectionHeadHeading>
        <SectionHeadActions>
          <ScrollRowPrevButton aria-label={prevLabel} />
          <ScrollRowNextButton aria-label={nextLabel} />
        </SectionHeadActions>
      </SectionHead>
      <ScrollRowViewport data-testid="row-scroller-bleed" style={cardVars}>
        {children}
      </ScrollRowViewport>
    </ScrollRow>
  );
}

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
  items: HomeMediaItem[];
  isBackdrop: boolean;
  rowKind: RowKind;
  /**
   * Pass `undefined` (not a null-rendering element) when no slot is needed —
   * any non-null ReactNode inflates the virtualizer count and adds a blank slot.
   * Renders outside the virtualized range (always mounted), so keep it compact.
   */
  trailingSlot?: ReactNode;
  onRangeChange: (range: { startIndex: number; endIndex: number }) => void;
  onWatchlistToggle?: (item: HomeMediaItem) => void;
  onCardClick?: (id: string) => void;
}

/** Virtualized track of cards, with an optional trailing slot for pagination state (#888). */
export function RowItemTrack({
  heading,
  items,
  isBackdrop,
  rowKind,
  trailingSlot,
  onRangeChange,
  onWatchlistToggle,
  onCardClick,
}: RowItemTrackProps) {
  return (
    <ScrollRowTrack
      virtualize
      aria-label={heading}
      className="scroll-px-8 pb-3"
      items={items}
      getKey={(item) => item.id}
      estimateItemWidth={isBackdrop ? 320 : 200}
      onRangeChange={onRangeChange}
      trailingSlot={trailingSlot}
      renderItem={(item) => (
        <Card
          item={item}
          rowKind={rowKind}
          onWatchlistToggle={onWatchlistToggle}
          onClick={onCardClick}
        />
      )}
    />
  );
}
