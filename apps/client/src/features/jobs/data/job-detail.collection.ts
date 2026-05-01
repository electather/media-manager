import { createCollection } from "@tanstack/react-db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { omit } from "es-toolkit/object";
import type { JobHandle } from "@ent-mcp/shared/jobs";
import { api } from "@/shared/lib/api";
import { queryClient } from "@/shared/lib/db";
import { jobsListCollection } from "./jobs-list.collection";

const VIRTUAL_PROPS = ["$collectionId", "$key", "$origin", "$synced"] as const;

function stripVirtualProps(row: object): JobHandle {
  return omit(row as Record<string, unknown>, VIRTUAL_PROPS) as unknown as JobHandle;
}

export function jobDetailCollection(jobId: string) {
  const queryKey = ["admin", "jobs", "detail.job", jobId];
  // Seed the detail cache from the list so the drawer renders instantly when
  // the row is already known. The 5s refetch overwrites with server truth.
  const seed = jobsListCollection.get(jobId);
  if (seed && !queryClient.getQueryData(queryKey)) {
    queryClient.setQueryData(queryKey, [stripVirtualProps(seed)]);
  }
  return createCollection(
    queryCollectionOptions<JobHandle>({
      id: `admin.jobs.detail.${jobId}`,
      queryKey,
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
