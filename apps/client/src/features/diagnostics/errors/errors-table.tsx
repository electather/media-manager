import { useQuery } from "@tanstack/react-query";
import { FilterIcon, InboxIcon, AlertTriangleIcon } from "lucide-react";
import { Card } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import { diagnosticsKeys } from "../shared/query-keys";
import { fetchErrorList } from "../shared/fetchers";
import { ThreadChip } from "../thread-chip";
import { ErrorRow } from "./error-row";
import type { ErrorListRow, ErrorsFilters } from "../shared/types";

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
  const list = useQuery({
    queryKey: diagnosticsKeys.errors.list(filters),
    queryFn: () => fetchErrorList(filters),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

  const rows: ErrorListRow[] = (list.data?.records as ErrorListRow[] | undefined) ?? [];
  const total = list.data?.total ?? 0;
  const pinnedRequestId = filters.requestId.trim();

  return (
    <div className="flex flex-col gap-4">
      {pinnedRequestId ? (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm text-foreground/85">
          <FilterIcon className="size-3.5 text-muted-foreground" />
          <span>Pinned to</span>
          <ThreadChip requestId={pinnedRequestId} />
          <span className="text-muted-foreground">
            — {rows.length} {rows.length === 1 ? "match" : "matches"}.
          </span>
          <span className="ml-auto" />
          <Button variant="outline" size="sm" onClick={onClearRequestId}>
            Clear thread
          </Button>
        </div>
      ) : null}

      <Card className="overflow-hidden p-0">
        {list.isPending ? (
          <SkeletonRows />
        ) : list.isError ? (
          <EmptyState
            icon="error"
            title="Couldn't load diagnostics"
            body="The diagnostics service didn't respond. Try again."
          >
            <Button variant="outline" size="sm" onClick={() => list.refetch()}>
              Retry
            </Button>
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="empty"
            title="No errors match these filters"
            body="Try broadening severity or source, widening the date range, or clearing the request-ID pin."
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
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5 font-mono text-[11px] text-muted-foreground/80">
              <span>
                {rows.length} of {total} · newest first
              </span>
              <span>100 / page</span>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

function SkeletonRows() {
  return (
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
  );
}

interface EmptyStateProps {
  icon: "error" | "empty";
  title: string;
  body: string;
  children?: React.ReactNode;
}

function EmptyState({ icon, title, body, children }: EmptyStateProps) {
  const Icon = icon === "error" ? AlertTriangleIcon : InboxIcon;
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="flex size-11 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <div>
        <div className="text-sm font-medium text-foreground">{title}</div>
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{body}</p>
      </div>
      {children}
    </div>
  );
}
