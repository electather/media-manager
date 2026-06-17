import { Suspense, useState, useTransition } from "react";
import { m } from "@/paraglide/messages";
import { DiagnosticsErrorBoundary } from "../shared/error-boundary";
import { diagnosticsKeys } from "../shared/query-keys";
import { PerfStatsCards } from "./perf-stats-cards";
import { PerfFilterBar } from "./perf-filter-bar";
import { PerfAggregateTable, PerfAggregateTableSkeleton } from "./perf-aggregate-table";
import { PerfDetailSheet } from "./perf-detail-sheet";
import type { PerfAggregateGroup, PerfFilters } from "../shared/types";

interface Props {
  filters: PerfFilters;
  onFiltersChange: (next: PerfFilters) => void;
  onJumpThread: (requestId: string) => void;
  /** Perf record id deep-linked via the `pid` search param. When set, the
   *  detail sheet opens on the single-record drill view. */
  detailId: string | null;
  onCloseDetail: () => void;
}

export function PerfTab({
  filters,
  onFiltersChange,
  onJumpThread,
  detailId,
  onCloseDetail,
}: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<PerfAggregateGroup | null>(null);
  const [, startTransition] = useTransition();

  /** Wraps filter updates in a transition so React keeps the current
   *  Suspense subtree alive while the new query loads, preventing the
   *  skeleton from flashing on every keystroke. */
  const handleFiltersChange = (next: PerfFilters) => {
    startTransition(() => {
      onFiltersChange(next);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <PerfStatsCards />
      <PerfFilterBar filters={filters} onChange={handleFiltersChange} />
      <DiagnosticsErrorBoundary
        title={m.diagnostics_perf_load_failed_title()}
        body={m.diagnostics_perf_load_failed_body()}
        queryKey={diagnosticsKeys.perf.all()}
      >
        <Suspense fallback={<PerfAggregateTableSkeleton />}>
          <PerfAggregateTable
            filters={filters}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            selectedGroup={setSelectedGroup}
            onClearRequestId={() => handleFiltersChange({ ...filters, requestId: "" })}
          />
        </Suspense>
      </DiagnosticsErrorBoundary>
      <PerfDetailSheet
        group={selectedGroup}
        detailId={detailId}
        onClose={() => {
          setSelectedKey(null);
          setSelectedGroup(null);
          onCloseDetail();
        }}
        onJumpThread={onJumpThread}
      />
    </div>
  );
}
