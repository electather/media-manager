import { InboxIcon } from "lucide-react";
import { m } from "@/paraglide/messages";
import { Card } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { DiagnosticsEmpty } from "../shared/diagnostics-empty";
import { PinnedThreadBanner } from "../shared/pinned-thread-banner";
import { useErrorsList } from "./use-errors-list";
import { ErrorRow } from "./error-row";
import type { ErrorsFilters } from "../shared/types";

interface Props {
  filters: ErrorsFilters;
  onClearRequestId: () => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onJumpThread: (requestId: string) => void;
}

export function ErrorsTable({
  filters,
  onClearRequestId,
  selectedId,
  onSelect,
  onJumpThread,
}: Props) {
  const { data } = useErrorsList(filters);
  const rows = data.records;
  const total = data.total;
  const pinnedRequestId = filters.requestId.trim();

  return (
    <div className="flex flex-col gap-4">
      {pinnedRequestId ? (
        <PinnedThreadBanner
          label={m.diagnostics_pinned_thread_pinned_to()}
          requestId={pinnedRequestId}
          matches={rows.length}
          onClearRequestId={onClearRequestId}
        />
      ) : null}

      <Card className="gap-0 overflow-hidden p-0">
        {rows.length === 0 ? (
          <DiagnosticsEmpty
            icon={InboxIcon}
            title={m.diagnostics_errors_empty_title()}
            body={m.diagnostics_errors_empty_body()}
          />
        ) : (
          <>
            {rows.map((row) => (
              <ErrorRow
                key={row.id}
                row={row}
                isOpen={selectedId === row.id}
                onOpen={(id) => onSelect(id === selectedId ? null : id)}
                onJumpThread={onJumpThread}
              />
            ))}
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5 font-mono text-xs text-muted-foreground/80">
              <span>{m.diagnostics_errors_count_of_total({ rows: rows.length, total })}</span>
              <span>{m.diagnostics_errors_page_size()}</span>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/** Suspense fallback for the errors table. Exported so the tab can render it
 *  inside the `<Suspense>` boundary that wraps {@link ErrorsTable}. */
export function ErrorsTableSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-0 overflow-hidden p-0">
        <div>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="grid items-center gap-4 border-t border-border px-4 py-3 pl-6 grid-cols-[60px_16px_100px_minmax(0,1fr)_90px]"
            >
              <Skeleton className="h-3" />
              <Skeleton className="h-2 w-2 rounded-full" />
              <Skeleton className="h-4" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-5 rounded-full" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
