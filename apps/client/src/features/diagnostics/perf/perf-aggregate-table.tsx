import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, FilterIcon, GaugeIcon } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { diagnosticsKeys } from "../shared/query-keys";
import { fetchPerfAggregate } from "../shared/fetchers";
import { ThreadChip } from "../thread-chip";
import { PerfRow } from "./perf-row";
import type { PerfAggregateGroup, PerfFilters } from "../shared/types";

interface Props {
  filters: PerfFilters;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  selectedGroup: (group: PerfAggregateGroup | null) => void;
  onClearRequestId: () => void;
}

/** Computes a stable key for a group row so React keying and click handlers
 *  match on the same identity. Plugin groups have null route, so we fold them
 *  into a single canonical key. */
export function groupKey(group: PerfAggregateGroup): string {
  return `${group.kind}:${group.route ?? group.pluginId ?? "(unknown)"}`;
}

export function PerfAggregateTable({
  filters,
  selectedKey,
  onSelect,
  selectedGroup,
  onClearRequestId,
}: Props) {
  const aggregate = useQuery({
    queryKey: diagnosticsKeys.perf.aggregate(filters),
    queryFn: () => fetchPerfAggregate(filters),
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

  const sortedGroups = useMemo(() => {
    const groups = (aggregate.data?.groups as PerfAggregateGroup[] | undefined) ?? [];
    const sorted = [...groups].sort((a, b) => {
      switch (filters.sort) {
        case "p99":
          return b.p99 - a.p99;
        case "max":
          return b.max - a.max;
        case "count":
          return b.count - a.count;
        case "lastAt":
          return b.lastAt - a.lastAt;
        case "p50":
          return b.p50 - a.p50;
        case "p95":
        default:
          return b.p95 - a.p95;
      }
    });
    if (filters.search.trim().length === 0) return sorted;
    const q = filters.search.trim().toLowerCase();
    return sorted.filter((g) => (g.route ?? g.pluginId ?? "").toLowerCase().includes(q));
  }, [aggregate.data, filters.sort, filters.search]);

  const pinnedRequestId = filters.requestId.trim();

  return (
    <div className="flex flex-col gap-4">
      {pinnedRequestId ? (
        <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm text-foreground/85">
          <FilterIcon className="size-3.5 text-muted-foreground" />
          <span>Filtering perf rows touched by</span>
          <ThreadChip requestId={pinnedRequestId} />
          <span className="ml-auto" />
          <Button variant="outline" size="sm" onClick={onClearRequestId}>
            Clear thread
          </Button>
        </div>
      ) : null}

      <Card className="overflow-hidden p-0">
        {aggregate.isPending ? (
          <SkeletonRows />
        ) : aggregate.isError ? (
          <Empty
            icon="error"
            title="Couldn't load performance data"
            body="The diagnostics service didn't respond."
          >
            <Button variant="outline" size="sm" onClick={() => aggregate.refetch()}>
              Retry
            </Button>
          </Empty>
        ) : sortedGroups.length === 0 ? (
          <Empty
            icon="empty"
            title="No routes match"
            body="Try widening the range or clearing search and request-ID filters."
          />
        ) : (
          <>
            <div className="grid grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(60px,auto))_14px] items-center gap-4 border-b border-border bg-muted/30 px-4 py-2 font-mono text-[10px] tracking-wider text-muted-foreground/80 uppercase">
              <span>Route / call</span>
              <span className="text-right">p50</span>
              <span className="text-right">p95</span>
              <span className="text-right">p99</span>
              <span className="text-right">max</span>
              <span />
            </div>
            {sortedGroups.map((group) => {
              const key = groupKey(group);
              const isOpen = selectedKey === key;
              return (
                <PerfRow
                  key={key}
                  group={group}
                  isOpen={isOpen}
                  onOpen={() => {
                    onSelect(isOpen ? null : key);
                    selectedGroup(isOpen ? null : group);
                  }}
                />
              );
            })}
            <div className="flex items-center justify-between border-t border-border px-4 py-2.5 font-mono text-[11px] text-muted-foreground/80">
              <span>
                {sortedGroups.length} groups · sorted by {filters.sort}
              </span>
              {aggregate.data?.truncated ? (
                <span className="text-primary/85">sample capped at 50k rows</span>
              ) : (
                <span>{aggregate.data?.sampleSize ?? 0} samples</span>
              )}
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
          className="grid items-center gap-4 border-t border-border px-4 py-3 grid-cols-[minmax(0,1.2fr)_repeat(4,60px)_14px]"
        >
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
          <Skeleton className="h-4" />
          <Skeleton className="h-2 w-2" />
        </div>
      ))}
    </div>
  );
}

interface EmptyProps {
  icon: "error" | "empty";
  title: string;
  body: string;
  children?: React.ReactNode;
}

function Empty({ icon, title, body, children }: EmptyProps) {
  const Icon = icon === "error" ? AlertTriangleIcon : GaugeIcon;
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
