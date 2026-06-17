import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Tabs, TabsContent } from "@/shared/ui/tabs";
import {
  DiagnosticsTabsHeader,
  ErrorsTab,
  PerfTab,
  diagnosticsKeys,
  fetchErrorSummary,
  useDiagnosticsFilters,
} from "@/features/diagnostics";

const tabSchema = z.enum(["errors", "performance"]).optional();

const searchSchema = z.object({
  tab: tabSchema,
  rid: z
    .string()
    .regex(/^[0-9a-zA-Z_-]+$/)
    .max(64)
    .optional(),
  pid: z.string().max(128).optional(),
});

export const Route = createFileRoute("/_authenticated/_admin/admin/diagnostics")({
  component: AdminDiagnosticsPage,
  validateSearch: (search) => searchSchema.parse(search),
});

// Route orchestrator: search-param defaults plus one navigate wrapper per
// param (tab/rid/pid) are intrinsic to wiring the URL to the two tabs.
// fallow-ignore-next-line complexity
function AdminDiagnosticsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  const summary = useQuery({
    queryKey: diagnosticsKeys.errors.summary(),
    queryFn: fetchErrorSummary,
    // Polls every 60s. Shorter staleTime than the interval matches the live
    // errors header (shares the summary cache key); skip polling while the tab
    // is hidden or the client is offline.
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    networkMode: "online",
    staleTime: 30_000,
  });
  const errorCount = summary.data?.hourlyBuckets.reduce((acc, b) => acc + b.error, 0) ?? 0;

  const tab = search.tab ?? "errors";
  const requestId = search.rid ?? "";
  const perfDetailId = search.pid ?? null;

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

  const clearPerfDetail = () => {
    void navigate({
      search: (prev) => ({ ...prev, pid: undefined }),
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
            detailId={perfDetailId}
            onCloseDetail={clearPerfDetail}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
