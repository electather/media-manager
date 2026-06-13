import { useState } from "react";
import { ERROR_SEVERITIES, ERROR_SOURCES } from "@nama/shared/diagnostics";
import { ERRORS_DEFAULT_FILTERS } from "./errors/errors-filter-bar";
import { PERF_DEFAULT_FILTERS } from "./perf/perf-filter-bar";
import type { ErrorsFilters, PerfFilters } from "./shared/types";

interface DiagnosticsFiltersOptions {
  requestId: string;
  setRequestId: (rid: string) => void;
}

export function useDiagnosticsFilters({ requestId, setRequestId }: DiagnosticsFiltersOptions) {
  const [errorFiltersLocal, setErrorFiltersLocal] = useState<Omit<ErrorsFilters, "requestId">>(
    () => {
      const { requestId: _omit, ...rest } = ERRORS_DEFAULT_FILTERS;
      return rest;
    },
  );
  const [perfFiltersLocal, setPerfFiltersLocal] = useState<Omit<PerfFilters, "requestId">>(() => {
    const { requestId: _omit, ...rest } = PERF_DEFAULT_FILTERS;
    return rest;
  });
  const [errorSelectedId, setErrorSelectedId] = useState<string | null>(null);

  const errorFilters: ErrorsFilters = { ...errorFiltersLocal, requestId };
  const perfFilters: PerfFilters = { ...perfFiltersLocal, requestId };

  const handleErrorFiltersChange = (next: ErrorsFilters) => {
    const { requestId: nextRid, ...rest } = next;
    setErrorFiltersLocal(rest);
    if (nextRid !== requestId) setRequestId(nextRid);
  };

  const handlePerfFiltersChange = (next: PerfFilters) => {
    const { requestId: nextRid, ...rest } = next;
    setPerfFiltersLocal(rest);
    if (nextRid !== requestId) setRequestId(nextRid);
  };

  // Thread-chip click pins the request id (URL-shared) without switching
  // tab. Errors filter widens so the pinned row is visible regardless of
  // severity/source/range selection.
  const pinThread = (rid: string) => {
    setErrorFiltersLocal({
      ...errorFiltersLocal,
      severity: [...ERROR_SEVERITIES],
      source: [...ERROR_SOURCES],
      pluginId: null,
      range: "30d",
    });
    setErrorSelectedId(null);
    setRequestId(rid);
  };

  return {
    errorFilters,
    perfFilters,
    errorSelectedId,
    setErrorSelectedId,
    handleErrorFiltersChange,
    handlePerfFiltersChange,
    pinThread,
  };
}
