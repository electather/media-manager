import { TriangleAlertIcon } from "lucide-react";
import type { HomeRowStub } from "@ent-mcp/shared/home";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRowPagination } from "@/hooks/use-row-pagination";
import { ROW_DISPLAY } from "@/lib/home-display";
import { Card } from "./card";
import { RowCarousel } from "./row-carousel";
import { RowErrorBoundary } from "./row-error-boundary";

export interface RowProps {
  row: HomeRowStub;
  onRowUnavailable: (rowId: HomeRowStub["rowId"]) => void;
  /**
   * Treat every card in this row as above-the-fold. Used for the first row
   * on the home feed so its artwork starts loading immediately instead of
   * waiting on intersection.
   */
  isFirstRow?: boolean;
}

const EMPTY_RETAINED_COPY: Partial<Record<HomeRowStub["rowId"], string>> = {
  upcomingForYou: "You're all caught up on upcoming episodes.",
};

export function Row({ row, onRowUnavailable, isFirstRow }: RowProps) {
  return (
    <RowErrorBoundary>
      <RowInner row={row} onRowUnavailable={onRowUnavailable} isFirstRow={isFirstRow} />
    </RowErrorBoundary>
  );
}

function RowInner({ row, onRowUnavailable, isFirstRow }: RowProps) {
  const pagination = useRowPagination({
    rowId: row.rowId,
    initialCursor: row.initialCursor,
    onUnavailable: () => onRowUnavailable(row.rowId),
  });

  const display = ROW_DISPLAY[row.rowId];
  const title = row.title;

  if (pagination.isPending) {
    return <RowSkeleton title={title} aspectRatio={display.aspectRatio} />;
  }

  // Suppress the "caught up" copy when partial data means the row might
  // actually have content that failed to load.
  const isEmptyRetained =
    pagination.items.length === 0 && !pagination.isPartial && EMPTY_RETAINED_COPY[row.rowId];

  return (
    <section className="flex flex-col gap-2" aria-labelledby={`row-${row.rowId}`}>
      <div className="flex items-center gap-2 px-4 lg:px-6">
        <h2
          id={`row-${row.rowId}`}
          data-testid="row-title"
          className="text-[15px] font-medium text-foreground"
        >
          {title}
        </h2>
        {pagination.isPartial ? (
          <Tooltip>
            <TooltipTrigger
              aria-label="Some sources didn't respond"
              className="inline-flex items-center text-muted-foreground"
            >
              <TriangleAlertIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>
              Some sources didn&apos;t respond — showing what we could fetch.
            </TooltipContent>
          </Tooltip>
        ) : null}
        {row.subtitle ? (
          <span className="text-[13px] text-muted-foreground">{row.subtitle}</span>
        ) : null}
      </div>

      <div className="px-4 lg:px-6">
        {isEmptyRetained ? (
          <p className="py-6 text-sm text-muted-foreground">{EMPTY_RETAINED_COPY[row.rowId]}</p>
        ) : pagination.items.length === 1 &&
          display.aspectRatio === "backdrop" &&
          pagination.items[0] ? (
          <div className="max-w-md">
            <Card item={pagination.items[0]} rowId={row.rowId} size="row" priority={isFirstRow} />
          </div>
        ) : (
          <RowCarousel
            rowId={row.rowId}
            items={pagination.items}
            hasMore={pagination.hasMore}
            isFetching={pagination.isFetching}
            onNearEnd={pagination.fetchNext}
            priority={isFirstRow}
          />
        )}
      </div>
    </section>
  );
}

interface RowSkeletonProps {
  title: string;
  aspectRatio: "poster" | "backdrop";
}

function RowSkeleton({ title, aspectRatio }: RowSkeletonProps) {
  return (
    <section className="flex flex-col gap-2" aria-busy>
      <div className="px-4 lg:px-6">
        <p className="text-[15px] font-medium text-foreground">{title}</p>
      </div>
      <div className="flex gap-3 overflow-hidden px-4 lg:px-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton
            key={i}
            className={
              aspectRatio === "poster"
                ? "aspect-[2/3] w-[140px] shrink-0 md:w-[160px] xl:w-[180px]"
                : "aspect-video w-[220px] shrink-0 md:w-[250px] xl:w-[280px]"
            }
          />
        ))}
      </div>
    </section>
  );
}
