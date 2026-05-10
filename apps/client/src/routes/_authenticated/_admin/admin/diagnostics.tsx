import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Tabs, TabsContent } from "@/shared/ui/tabs";
import { ErrorsTab } from "@/features/diagnostics/errors/errors-tab";
import { PerfTab } from "@/features/diagnostics/perf/perf-tab";
import { DiagnosticsTabsHeader } from "@/features/diagnostics/diagnostics-tabs-header";
import { useDiagnosticsFilters } from "@/features/diagnostics/use-diagnostics-filters";
import { fetchErrorSummary } from "@/features/diagnostics/shared/fetchers";
import { diagnosticsKeys } from "@/features/diagnostics/shared/query-keys";

const tabSchema = z.enum(["errors", "performance"]).optional();

const searchSchema = z.object({
  tab: tabSchema,
  rid: z.string().optional(),
});

export const Route = createFileRoute("/_authenticated/_admin/admin/diagnostics")({
  component: AdminDiagnosticsPage,
  validateSearch: (search) => searchSchema.parse(search),
});

function AdminDiagnosticsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

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

  const filters = useDiagnosticsFilters({ requestId, setRequestId });

  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <Tabs value={tab} onValueChange={(v) => setTab(v as "errors" | "performance")}>
        <DiagnosticsTabsHeader errorCount={errorCount} />

        <TabsContent value="errors" className="pt-4">
          <ErrorsTab
            filters={filters.errorFilters}
            onFiltersChange={filters.handleErrorFiltersChange}
            selectedId={filters.errorSelectedId}
            onSelect={filters.setErrorSelectedId}
            onJumpThread={filters.pinThread}
          />
        </TabsContent>

        <TabsContent value="performance" className="pt-4">
          <PerfTab
            filters={filters.perfFilters}
            onFiltersChange={filters.handlePerfFiltersChange}
            onJumpThread={filters.pinThread}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
