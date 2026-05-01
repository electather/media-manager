import { createCollection } from "@tanstack/react-db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import type { JobHandle } from "@ent-mcp/shared/jobs";
import { api } from "@/shared/lib/api";
import { queryClient } from "@/shared/lib/db";

export function jobDetailCollection(jobId: string) {
  return createCollection(
    queryCollectionOptions<JobHandle>({
      id: `admin.jobs.detail.${jobId}`,
      queryKey: ["admin", "jobs", "detail.job", jobId],
      queryClient,
      refetchInterval: 5_000,
      meta: { persist: false },
      queryFn: async () => {
        const res = await api.admin.jobs[":id"].$get({
          param: { id: jobId },
          query: { limit: "30" },
        });
        if (!res.ok) throw new Error("failed to load job");
        const data = (await res.json()) as { job: JobHandle };
        return [data.job];
      },
      getKey: (job) => job.id,
    }),
  );
}
