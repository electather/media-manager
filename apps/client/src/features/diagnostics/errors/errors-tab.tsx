import { Suspense, useTransition } from "react";
import { DiagnosticsErrorBoundary } from "../shared/error-boundary";
import { diagnosticsKeys } from "../shared/query-keys";
import { ErrorsHeader } from "./errors-header";
import { ErrorsFilterBar } from "./errors-filter-bar";
import { ErrorsTable, ErrorsTableSkeleton } from "./errors-table";
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
  const [, startTransition] = useTransition();

  /** Wraps filter updates in a transition so React keeps the current
   *  Suspense subtree alive while the new query loads, preventing the
   *  skeleton from flashing on every keystroke. */
  const handleFiltersChange = (next: ErrorsFilters) => {
    startTransition(() => {
      onFiltersChange(next);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <ErrorsHeader />
      <ErrorsFilterBar filters={filters} onChange={handleFiltersChange} />
      <DiagnosticsErrorBoundary queryKey={diagnosticsKeys.errors.all()}>
        <Suspense fallback={<ErrorsTableSkeleton />}>
          <ErrorsTable
            filters={filters}
            onClearRequestId={() => handleFiltersChange({ ...filters, requestId: "" })}
            selectedId={selectedId}
            onSelect={onSelect}
            onJumpThread={onJumpThread}
          />
        </Suspense>
      </DiagnosticsErrorBoundary>
      <ErrorDetailSheet
        selectedId={selectedId}
        onClose={() => onSelect(null)}
        onJumpThread={onJumpThread}
      />
    </div>
  );
}
