import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ERROR_SEVERITIES, ERROR_SOURCES } from "@ent-mcp/shared/diagnostics";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { ErrorsTab } from "@/features/diagnostics/errors/errors-tab";
import { ERRORS_DEFAULT_FILTERS } from "@/features/diagnostics/errors/errors-filter-bar";
import { PerfTab } from "@/features/diagnostics/perf/perf-tab";
import { PERF_DEFAULT_FILTERS } from "@/features/diagnostics/perf/perf-filter-bar";
import { RetentionPopover } from "@/features/diagnostics/retention-popover";
import type { ErrorsFilters, PerfFilters } from "@/features/diagnostics/shared/types";

const tabSchema = z.enum(["errors", "performance"]).optional();

const searchSchema = z.object({
  tab: tabSchema,
});

export const Route = createFileRoute("/_authenticated/_settings/admin/diagnostics")({
  component: AdminDiagnosticsPage,
  validateSearch: (search) => searchSchema.parse(search),
});

function AdminDiagnosticsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const [errorFilters, setErrorFilters] = useState<ErrorsFilters>(ERRORS_DEFAULT_FILTERS);
  const [perfFilters, setPerfFilters] = useState<PerfFilters>(PERF_DEFAULT_FILTERS);
  const [errorSelectedId, setErrorSelectedId] = useState<string | null>(null);

  const tab = search.tab ?? "errors";
  const setTab = (next: "errors" | "performance") => {
    void navigate({ search: { tab: next === "errors" ? undefined : next }, replace: true });
  };

  // Cross-tab thread navigation: clicking a thread chip on one tab pins the
  // request id on the OTHER tab and switches to it. The acting tab keeps its
  // current filter so the user can pop back without losing state.
  const jumpFromErrorsToPerf = (rid: string) => {
    setPerfFilters({ ...perfFilters, requestId: rid });
    setTab("performance");
  };
  const jumpFromPerfToErrors = (rid: string) => {
    setErrorFilters({
      ...errorFilters,
      requestId: rid,
      severity: [...ERROR_SEVERITIES],
      source: [...ERROR_SOURCES],
      pluginId: null,
      range: "30d",
    });
    setErrorSelectedId(null);
    setTab("errors");
  };

  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Diagnostics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Captured errors and request timing across the host and plugins.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground/80">auto-refresh · 30s</span>
          <RetentionPopover />
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "errors" | "performance")}>
        <TabsList variant="line" className="border-b border-border">
          <TabsTrigger value="errors">Errors</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="errors" className="pt-4">
          <ErrorsTab
            filters={errorFilters}
            onFiltersChange={setErrorFilters}
            selectedId={errorSelectedId}
            onSelect={setErrorSelectedId}
            onJumpThread={jumpFromErrorsToPerf}
          />
        </TabsContent>

        <TabsContent value="performance" className="pt-4">
          <PerfTab
            filters={perfFilters}
            onFiltersChange={setPerfFilters}
            onJumpThread={jumpFromPerfToErrors}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
