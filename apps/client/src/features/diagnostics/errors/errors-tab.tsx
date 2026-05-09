import { ErrorsHeader } from "./errors-header";
import { ErrorsFilterBar } from "./errors-filter-bar";
import { ErrorsTable } from "./errors-table";
import { ErrorDetailSheet } from "./error-detail-sheet";
import type { ErrorsFilters } from "../shared/types";

interface Props {
  filters: ErrorsFilters;
  onFiltersChange: (next: ErrorsFilters) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onJumpThread: (requestId: string) => void;
}

export function ErrorsTab({ filters, onFiltersChange, selectedId, onSelect, onJumpThread }: Props) {
  return (
    <div className="flex flex-col gap-4">
      <ErrorsHeader />
      <ErrorsFilterBar filters={filters} onChange={onFiltersChange} />
      <ErrorsTable
        filters={filters}
        onClearRequestId={() => onFiltersChange({ ...filters, requestId: "" })}
        selectedId={selectedId}
        onSelect={onSelect}
        onJumpThread={onJumpThread}
      />
      <ErrorDetailSheet
        selectedId={selectedId}
        onClose={() => onSelect(null)}
        onJumpThread={onJumpThread}
      />
    </div>
  );
}
