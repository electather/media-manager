import { useCallback } from "react";
import { TriangleAlertIcon } from "lucide-react";
import type { HomeRowStub } from "@ent-mcp/shared/home";

import { useRowPagination } from "../hooks/use-row-pagination";
import { PAGINATION_THRESHOLD, RowCarousel } from "./row-carousel";
import { RowErrorBoundary } from "./row-error-boundary";

interface RowProps {
  stub: HomeRowStub;
  onUnavailable: (rowId: HomeRowStub["rowId"]) => void;
}

export function Row({ stub, onUnavailable }: RowProps) {
  return (
    <RowErrorBoundary rowTitle={stub.title}>
      <RowInner stub={stub} onUnavailable={onUnavailable} />
    </RowErrorBoundary>
  );
}

function RowInner({ stub, onUnavailable }: RowProps) {
  const pagination = useRowPagination({
    rowId: stub.rowId,
    initialCursor: stub.initialCursor,
    onUnavailable: () => onUnavailable(stub.rowId),
  });

  const onProgress = useCallback(
    (ratio: number) => {
      if (ratio >= PAGINATION_THRESHOLD) pagination.fetchNext();
    },
    [pagination],
  );

  if (pagination.isLoading) {
    return (
      <section className="flex flex-col gap-2 px-4 sm:px-6">
        <h3 className="text-[15px] font-semibold tracking-tight">{stub.title}</h3>
        <div className="flex gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="aspect-[2/3] w-[14%] min-w-32 animate-pulse rounded-md bg-muted"
            />
          ))}
        </div>
      </section>
    );
  }

  if (pagination.error || pagination.items.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 px-4 sm:px-6">
      <header className="flex items-center gap-2">
        <h3 className="text-[15px] font-semibold tracking-tight">{stub.title}</h3>
        {pagination.partial ? (
          <span title="Some sources didn't respond — showing what we could fetch.">
            <TriangleAlertIcon className="size-3.5 text-muted-foreground" aria-hidden />
            <span className="sr-only">Partial row data.</span>
          </span>
        ) : null}
      </header>
      <RowCarousel
        items={pagination.items}
        hasMore={pagination.hasMore}
        isFetchingNextPage={pagination.isFetchingNextPage}
        onProgress={onProgress}
      />
    </section>
  );
}
