import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangleIcon, GaugeIcon } from "lucide-react";
import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { diagnosticsKeys } from "../shared/query-keys";
import { fetchPerfAggregate } from "../shared/fetchers";
import { PinnedThreadBanner } from "../shared/pinned-thread-banner";
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

type SortKey = PerfFilters["sort"];

/** Lookup table that maps the chosen sort to a comparator. Replaces a
 *  switch statement so the parent component stays under the complexity
 *  threshold without a fallow suppression. */
const SORT_COMPARATORS: Record<SortKey, (a: PerfAggregateGroup, b: PerfAggregateGroup) => number> =
  {
    p50: (a, b) => b.p50 - a.p50,
    p95: (a, b) => b.p95 - a.p95,
    p99: (a, b) => b.p99 - a.p99,
    max: (a, b) => b.max - a.max,
    count: (a, b) => b.count - a.count,
    lastAt: (a, b) => b.lastAt - a.lastAt,
  };

function sortAndFilter(groups: PerfAggregateGroup[], filters: PerfFilters) {
  const compare = SORT_COMPARATORS[filters.sort] ?? SORT_COMPARATORS.p95;
  const sorted = [...groups].sort(compare);
  const q = filters.search.trim().toLowerCase();
  if (q.length === 0) return sorted;
  return sorted.filter((g) => (g.route ?? g.pluginId ?? "").toLowerCase().includes(q));
}

// Conditional rendering of pinned-banner + body branches over the query
// states is intrinsic; further extraction would not simplify.
// fallow-ignore-next-line complexity
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
    // Live monitoring table: stay under the 60s default so switching tabs and
    // reopening within the poll window does not show a full poll of stale rows.
    // Matches the sibling summary read in perf-stats-cards.tsx.
    staleTime: 30_000,
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

  const sortedGroups = useMemo(() => {
    const groups = (aggregate.data?.groups as PerfAggregateGroup[] | undefined) ?? [];
    return sortAndFilter(groups, filters);
  }, [aggregate.data, filters]);

  const pinnedRequestId = filters.requestId.trim();

  return (
    <div className="flex flex-col gap-4">
      {pinnedRequestId ? (
        <PinnedThreadBanner
          label={m.diagnostics_perf_filter_pinned_label()}
          requestId={pinnedRequestId}
          onClearRequestId={onClearRequestId}
        />
      ) : null}

      <Card className="gap-0 overflow-hidden p-0">
        <PerfAggregateBody
          isPending={aggregate.isPending}
          isError={aggregate.isError}
          refetch={() => aggregate.refetch()}
          groups={sortedGroups}
          selectedKey={selectedKey}
          onSelect={onSelect}
          selectedGroup={selectedGroup}
          sort={filters.sort}
          truncated={aggregate.data?.truncated ?? false}
          sampleSize={aggregate.data?.sampleSize ?? 0}
        />
      </Card>
    </div>
  );
}

interface PerfAggregateBodyProps {
  isPending: boolean;
  isError: boolean;
  refetch: () => void;
  groups: PerfAggregateGroup[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  selectedGroup: (group: PerfAggregateGroup | null) => void;
  sort: PerfFilters["sort"];
  truncated: boolean;
  sampleSize: number;
}

function PerfAggregateBody({
  isPending,
  isError,
  refetch,
  groups,
  selectedKey,
  onSelect,
  selectedGroup,
  sort,
  truncated,
  sampleSize,
}: PerfAggregateBodyProps) {
  if (isPending) return <SkeletonRows />;
  if (isError) {
    return (
      <Empty
        icon="error"
        title={m.diagnostics_perf_load_failed_title()}
        body={m.diagnostics_perf_load_failed_body()}
      >
        <Button variant="outline" size="sm" onClick={refetch}>
          {m.diagnostics_errors_retry()}
        </Button>
      </Empty>
    );
  }
  if (groups.length === 0) {
    return (
      <Empty
        icon="empty"
        title={m.diagnostics_perf_empty_title()}
        body={m.diagnostics_perf_empty_body()}
      />
    );
  }
  return (
    <>
      <PerfTableHeader />
      {groups.map((group) => {
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
      <PerfTableFooter
        groupCount={groups.length}
        sort={sort}
        truncated={truncated}
        sampleSize={sampleSize}
      />
    </>
  );
}

function PerfTableHeader() {
  return (
    <div className="hidden grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(60px,auto))_14px] items-center gap-4 border-b border-border bg-muted/30 px-4 py-2 font-mono text-xs tracking-wider text-muted-foreground/80 uppercase sm:grid">
      <span>{m.diagnostics_perf_route_or_call()}</span>
      <span className="text-right">{m.diagnostics_perf_label_p50()}</span>
      <span className="text-right">{m.diagnostics_perf_label_p95()}</span>
      <span className="text-right">{m.diagnostics_perf_label_p99()}</span>
      <span className="text-right">{m.diagnostics_perf_label_max()}</span>
      <span />
    </div>
  );
}

function PerfTableFooter({
  groupCount,
  sort,
  truncated,
  sampleSize,
}: {
  groupCount: number;
  sort: PerfFilters["sort"];
  truncated: boolean;
  sampleSize: number;
}) {
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-2.5 font-mono text-xs text-muted-foreground/80">
      <span>{m.diagnostics_perf_groups_summary({ count: groupCount, sort })}</span>
      {truncated ? (
        <span className="text-primary/85">{m.diagnostics_perf_truncated()}</span>
      ) : (
        <span>{m.diagnostics_perf_sample_size({ count: sampleSize })}</span>
      )}
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
