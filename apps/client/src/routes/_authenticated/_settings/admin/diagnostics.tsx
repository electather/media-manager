import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ERROR_SEVERITIES, ERROR_SOURCES } from "@ent-mcp/shared/diagnostics";
import { Badge } from "@/shared/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { ErrorsTab } from "@/features/diagnostics/errors/errors-tab";
import { ERRORS_DEFAULT_FILTERS } from "@/features/diagnostics/errors/errors-filter-bar";
import { PerfTab } from "@/features/diagnostics/perf/perf-tab";
import { PERF_DEFAULT_FILTERS } from "@/features/diagnostics/perf/perf-filter-bar";
import { RetentionPopover } from "@/features/diagnostics/retention-popover";
import { fetchErrorSummary } from "@/features/diagnostics/shared/fetchers";
import { diagnosticsKeys } from "@/features/diagnostics/shared/query-keys";
import type { ErrorsFilters, PerfFilters } from "@/features/diagnostics/shared/types";

const tabSchema = z.enum(["errors", "performance"]).optional();

const searchSchema = z.object({
  tab: tabSchema,
  rid: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/_settings/admin/diagnostics")({
  component: AdminDiagnosticsPage,
  validateSearch: (search) => searchSchema.parse(search),
});

function AdminDiagnosticsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

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

  const summary = useQuery({
    queryKey: diagnosticsKeys.errors.summary(),
    queryFn: fetchErrorSummary,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const errorCount = summary.data?.hourlyBuckets.reduce((acc, b) => acc + b.error, 0) ?? 0;

  const tab = search.tab ?? "errors";
  const requestId = search.rid ?? "";

  const setTab = (next: "errors" | "performance") => {
    void navigate({
      search: (prev) => ({ ...prev, tab: next === "errors" ? undefined : next }),
      replace: true,
    });
  };

  const setRequestId = (rid: string) => {
    void navigate({
      search: (prev) => ({ ...prev, rid: rid.trim() ? rid.trim() : undefined }),
      replace: true,
    });
  };

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

  // Thread-chip click pins the request id in the URL (shared across both
  // tabs) without switching tab. Errors filter widens so the pinned row is
  // visible regardless of severity/source/range selection.
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

  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "errors" | "performance")}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border">
          <TabsList variant="line">
            <TabsTrigger value="errors">
              Errors
              {errorCount > 0 ? (
                <Badge variant="destructive" className="ml-1.5">
                  {errorCount}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="performance">Performance</TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2 pb-2">
            <span className="hidden font-mono text-xs text-muted-foreground/80 md:inline">
              auto-refresh · 30s
            </span>
            <Badge
              variant="outline"
              className="hidden font-mono text-muted-foreground sm:inline-flex"
            >
              read-only
            </Badge>
            <RetentionPopover />
          </div>
        </div>

        <TabsContent value="errors" className="pt-4">
          <ErrorsTab
            filters={errorFilters}
            onFiltersChange={handleErrorFiltersChange}
            selectedId={errorSelectedId}
            onSelect={setErrorSelectedId}
            onJumpThread={pinThread}
          />
        </TabsContent>

        <TabsContent value="performance" className="pt-4">
          <PerfTab
            filters={perfFilters}
            onFiltersChange={handlePerfFiltersChange}
            onJumpThread={pinThread}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
