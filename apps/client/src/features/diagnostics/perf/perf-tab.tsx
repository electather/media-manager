import { useState } from "react";
import { PerfStatsCards } from "./perf-stats-cards";
import { PerfFilterBar } from "./perf-filter-bar";
import { PerfAggregateTable } from "./perf-aggregate-table";
import { PerfDetailSheet } from "./perf-detail-sheet";
import type { PerfAggregateGroup, PerfFilters } from "../shared/types";

interface Props {
  filters: PerfFilters;
  onFiltersChange: (next: PerfFilters) => void;
  onJumpThread: (requestId: string) => void;
}

export function PerfTab({ filters, onFiltersChange, onJumpThread }: Props) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<PerfAggregateGroup | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <PerfStatsCards />
      <PerfFilterBar filters={filters} onChange={onFiltersChange} />
      <PerfAggregateTable
        filters={filters}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        selectedGroup={setSelectedGroup}
        onClearRequestId={() => onFiltersChange({ ...filters, requestId: "" })}
      />
      <PerfDetailSheet
        group={selectedGroup}
        detailId={null}
        onClose={() => {
          setSelectedKey(null);
          setSelectedGroup(null);
        }}
        onJumpThread={onJumpThread}
      />
    </div>
  );
}
