import { TriangleAlertIcon } from "lucide-react";
import type { HomeRow } from "@ent-mcp/shared/home";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRowPagination } from "@/hooks/use-row-pagination";
import { ROW_DISPLAY } from "@/lib/home-display";
import { Card } from "./card";
import { RowCarousel } from "./row-carousel";
import { RowErrorBoundary } from "./row-error-boundary";

export interface RowProps {
  row: HomeRow;
  onRowUnavailable: (rowId: HomeRow["rowId"]) => void;
}

const EMPTY_RETAINED_COPY: Partial<Record<HomeRow["rowId"], string>> = {
  upcomingForYou: "You're all caught up on upcoming episodes.",
};

export function Row({ row, onRowUnavailable }: RowProps) {
  return (
    <RowErrorBoundary>
      <RowInner row={row} onRowUnavailable={onRowUnavailable} />
    </RowErrorBoundary>
  );
}

function RowInner({ row, onRowUnavailable }: RowProps) {
  const pagination = useRowPagination({
    rowId: row.rowId,
    initialItems: row.items,
    initialCursor: row.cursor,
    onUnavailable: () => onRowUnavailable(row.rowId),
  });

  const display = ROW_DISPLAY[row.rowId];
  const title = row.titleOverride ?? row.title;
  const isEmptyRetained = pagination.items.length === 0 && EMPTY_RETAINED_COPY[row.rowId];

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
        {row.partial ? (
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
            <Card item={pagination.items[0]} rowId={row.rowId} size="row" />
          </div>
        ) : (
          <RowCarousel
            rowId={row.rowId}
            items={pagination.items}
            hasMore={pagination.hasMore}
            isFetching={pagination.isFetching}
            onNearEnd={pagination.fetchNext}
          />
        )}
      </div>
    </section>
  );
}
