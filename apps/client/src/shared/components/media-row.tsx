import { ChevronLeft, ChevronRight, CircleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FocusEvent, type ReactNode } from "react";
import { m } from "@/paraglide/messages";
import { MediaCardSkeleton } from "@/features/media/components/media-card-skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { useDirection } from "@/shared/ui/direction";
import { cn } from "@/shared/lib/utils";
import { Button } from "../ui/button";

const PREFETCH_THRESHOLD_CARDS = 6;
const SKELETON_COUNT = 6;
const GAP_PX = 12;
const ARROW_SCROLL_RATIO = 0.85;
const SCROLL_EDGE_SLACK_PX = 32;
const CARD_WIDTH_BACKDROP_PX = 268;
const CARD_WIDTH_POSTER_PX = 184;

type Aspect = "16/9" | "2/3";

type MediaRowItemBase = { id: string };

export type MediaRowProps<TItem extends MediaRowItemBase> = {
  title: string;
  items: readonly TItem[];
  defaultAspect: Aspect;
  isLoading?: boolean;
  hasMore?: boolean;
  partial?: boolean;
  onLoadMore?: () => void;
  renderItem: (item: TItem) => ReactNode;
  className?: string;
};

export function MediaRow<TItem extends MediaRowItemBase>({
  title,
  items,
  defaultAspect,
  isLoading = false,
  hasMore = false,
  partial = false,
  onLoadMore,
  renderItem,
  className,
}: MediaRowProps<TItem>) {
  const trackRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(items.length > 0);
  const [hover, setHover] = useState(false);
  const direction = useDirection();
  const isRtl = direction === "rtl";

  const cardWidth = defaultAspect === "16/9" ? CARD_WIDTH_BACKDROP_PX : CARD_WIDTH_POSTER_PX;

  const update = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // Modern browsers report scrollLeft as 0 at the inline-start edge and a
    // negative value as the user scrolls toward inline-end in RTL. Normalize
    // to a non-negative offset measured from the start.
    const offsetFromStart = Math.abs(el.scrollLeft);
    setCanPrev(offsetFromStart > SCROLL_EDGE_SLACK_PX);
    setCanNext(offsetFromStart < max - SCROLL_EDGE_SLACK_PX);

    if (!onLoadMore || !hasMore || isLoading) return;
    const remainingPx = max - offsetFromStart;
    const triggerPx = (cardWidth + GAP_PX) * PREFETCH_THRESHOLD_CARDS;
    if (remainingPx < triggerPx) onLoadMore();
  }, [cardWidth, hasMore, isLoading, onLoadMore]);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [update]);

  useEffect(() => {
    update();
  }, [items.length, isLoading, update]);

  // step: +1 means scroll toward inline-end (next), -1 toward inline-start
  // (prev). scrollBy's `left` is physical, so flip the sign in RTL.
  const scrollByDirection = (step: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    const physical = isRtl ? -step : step;
    const amount = Math.round(el.clientWidth * ARROW_SCROLL_RATIO) * physical;
    el.scrollBy({ left: amount, behavior: "smooth" });
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setHover(false);
  };

  return (
    <section className={cn("relative", className)}>
      <header className="mb-2.5 flex items-center justify-between pe-2">
        <div className="flex items-center gap-2">
          <h2 className="text-base ms-6 font-semibold tracking-tight text-foreground">{title}</h2>
          {partial && (
            <Tooltip>
              <TooltipTrigger
                className="inline-flex text-muted-foreground"
                aria-label={m.media_row_partial_tooltip()}
              >
                <CircleAlert className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent>{m.media_row_partial_tooltip()}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </header>

      <div
        ref={wrapRef}
        className="relative"
        onMouseEnter={() => setHover(true)}
        onFocus={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onBlur={handleBlur}
      >
        <div
          ref={trackRef}
          className={cn(
            "-my-10 flex snap-x snap-proximity overflow-x-auto overflow-y-hidden scroll-smooth py-10 px-6 scroll-px-6",
            "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          )}
          style={{ gap: GAP_PX }}
        >
          {items.map((item) => (
            <div key={item.id} className="snap-start" style={{ flex: `0 0 ${cardWidth}px` }}>
              {renderItem(item)}
            </div>
          ))}
          {isLoading &&
            Array.from({ length: SKELETON_COUNT }).map((_, i) => (
              <div
                key={`skeleton-${i}`}
                className="snap-start"
                style={{ flex: `0 0 ${cardWidth}px` }}
              >
                <MediaCardSkeleton aspect={defaultAspect} />
              </div>
            ))}
        </div>

        <EdgeFade side="start" visible={canPrev} isRtl={isRtl} />
        <EdgeFade side="end" visible={canNext} isRtl={isRtl} />

        <RowArrow
          side="start"
          isRtl={isRtl}
          ariaLabel={m.media_row_prev_aria({ title })}
          visible={hover && canPrev}
          disabled={!canPrev}
          onClick={() => scrollByDirection(-1)}
        />
        <RowArrow
          side="end"
          isRtl={isRtl}
          ariaLabel={m.media_row_next_aria({ title })}
          visible={hover && canNext}
          disabled={!canNext}
          onClick={() => scrollByDirection(1)}
        />
      </div>
    </section>
  );
}

function EdgeFade({
  side,
  visible,
  isRtl,
}: {
  side: "start" | "end";
  visible: boolean;
  isRtl: boolean;
}) {
  const isStart = side === "start";
  // Gradient origin is the solid edge fading toward transparent. In LTR the
  // start edge is on the left, in RTL on the right; flip the gradient axis to
  // match.
  const gradientClass = isStart
    ? isRtl
      ? "bg-gradient-to-l"
      : "bg-gradient-to-r"
    : isRtl
      ? "bg-gradient-to-r"
      : "bg-gradient-to-l";
  return (
    <div
      aria-hidden="true"
      data-visible={visible ? "true" : "false"}
      className={cn(
        "pointer-events-none absolute inset-y-10 z-1 w-12 transition-opacity duration-200 data-[visible=false]:opacity-0",
        isStart ? "start-0" : "end-0",
        gradientClass,
        "from-background to-transparent",
      )}
    />
  );
}

function RowArrow({
  side,
  isRtl,
  ariaLabel,
  visible,
  disabled,
  onClick,
}: {
  side: "start" | "end";
  isRtl: boolean;
  ariaLabel: string;
  visible: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const isStart = side === "start";
  const Icon = isStart ? (isRtl ? ChevronRight : ChevronLeft) : isRtl ? ChevronLeft : ChevronRight;
  // Centering lives on the wrapper so the Button's own transform-driven
  // active state (`active:translate-y-px`) doesn't clobber `-translate-y-1/2`
  // — both write `--tw-translate-y`, which would jump the arrow downward by
  // half its height on press.
  return (
    <div
      data-visible={visible ? "true" : "false"}
      className={cn(
        "absolute top-1/2 z-2 -translate-y-1/2",
        "transition-opacity duration-150 data-[visible=false]:pointer-events-none data-[visible=false]:opacity-0",
        isStart ? "inset-s-2" : "inset-e-2",
      )}
    >
      <Button
        type="button"
        tabIndex={-1}
        aria-label={ariaLabel}
        onClick={onClick}
        disabled={disabled}
        variant="secondary"
        size="icon"
        className={cn("rounded-full", "disabled:cursor-not-allowed disabled:opacity-40")}
      >
        <Icon />
      </Button>
    </div>
  );
}
