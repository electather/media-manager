import { useMemo } from "react";
import { GaugeIcon } from "lucide-react";
import { m } from "@/paraglide/messages";
import { Card } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { DiagnosticsEmpty } from "../shared/diagnostics-empty";
import { PinnedThreadBanner } from "../shared/pinned-thread-banner";
import { usePerfAggregate } from "./use-perf-aggregate";
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

export function sortAndFilter(groups: PerfAggregateGroup[], filters: PerfFilters) {
  const compare = SORT_COMPARATORS[filters.sort] ?? SORT_COMPARATORS.p95;
  const sorted = [...groups].sort(compare);
  const q = filters.search.trim().toLowerCase();
  if (q.length === 0) return sorted;
  return sorted.filter((g) => (g.route ?? g.pluginId ?? "").toLowerCase().includes(q));
}

export function PerfAggregateTable({
  filters,
  selectedKey,
  onSelect,
  selectedGroup,
  onClearRequestId,
}: Props) {
  const { data } = usePerfAggregate(filters);

  const sortedGroups = useMemo(() => sortAndFilter(data.groups, filters), [data.groups, filters]);

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
        {sortedGroups.length === 0 ? (
          <DiagnosticsEmpty
            icon={GaugeIcon}
            title={m.diagnostics_perf_empty_title()}
            body={m.diagnostics_perf_empty_body()}
          />
        ) : (
          <>
            <PerfTableHeader />
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
            <PerfTableFooter
              groupCount={sortedGroups.length}
              sort={filters.sort}
              truncated={data.truncated}
              sampleSize={data.sampleSize}
            />
          </>
        )}
      </Card>
    </div>
  );
}

function PerfTableHeader() {
  return (
    <div className="hidden grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(60px,auto))_14px] items-center gap-4 border-b border-border bg-muted/30 px-4 py-2 font-mono text-xs tracking-wider text-muted-foreground/80 uppercase sm:grid">
      <span>{m.diagnostics_perf_route_or_call()}</span>
      <span className="text-end">{m.diagnostics_perf_label_p50()}</span>
      <span className="text-end">{m.diagnostics_perf_label_p95()}</span>
      <span className="text-end">{m.diagnostics_perf_label_p99()}</span>
      <span className="text-end">{m.diagnostics_perf_label_max()}</span>
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

/** Suspense fallback for the perf table. Exported so the tab can render it
 *  inside the `<Suspense>` boundary that wraps {@link PerfAggregateTable}. */
export function PerfAggregateTableSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-0 overflow-hidden p-0">
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
      </Card>
    </div>
  );
}
