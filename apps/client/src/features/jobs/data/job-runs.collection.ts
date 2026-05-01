import { createCollection } from "@tanstack/react-db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import type { JobRunSummary } from "@ent-mcp/shared/jobs";
import { api } from "@/shared/lib/api";
import { createCollectionRegistry, queryClient } from "@/shared/lib/db";

function buildRunsCollection(jobId: string) {
  return createCollection(
    queryCollectionOptions<JobRunSummary>({
      id: `admin.jobs.runs.${jobId}`,
      queryKey: ["admin", "jobs", "runs", jobId],
      queryClient,
      refetchInterval: 5_000,
      queryFn: async () => {
        const res = await api.admin.jobs[":id"].runs.$get({
          param: { id: jobId },
          query: { limit: "30" },
        });
        if (!res.ok) throw new Error("failed to load runs");
        const data = (await res.json()) as { runs: JobRunSummary[] };
        return data.runs;
      },
      getKey: (run) => run.id,
    }),
  );
}

export const jobRunsRegistry = createCollectionRegistry(buildRunsCollection);
export type JobRunsCollection = ReturnType<typeof buildRunsCollection>;
