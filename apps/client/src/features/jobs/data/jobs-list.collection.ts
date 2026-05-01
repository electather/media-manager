import { createCollection } from "@tanstack/react-db";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import type { JobHandle } from "@ent-mcp/shared/jobs";
import { api } from "@/shared/lib/api";
import { queryClient } from "@/shared/lib/db";

export const jobsListCollection = createCollection(
  queryCollectionOptions<JobHandle>({
    id: "admin.jobs.list",
    queryKey: ["admin", "jobs", "list"],
    queryClient,
    refetchInterval: 10_000,
    meta: { persist: false },
    queryFn: async () => {
      const res = await api.admin.jobs.$get();
      if (!res.ok) throw new Error("failed to load jobs");
      const data = (await res.json()) as { jobs: JobHandle[] };
      return data.jobs;
    },
    getKey: (job) => job.id,
    onUpdate: async ({ transaction }) => {
      for (const mutation of transaction.mutations) {
        const id = mutation.key as string;
        const modified = mutation.modified as JobHandle;
        const changes = mutation.changes as Partial<JobHandle>;
        const enabled = changes.enabled ?? modified.enabled;
        const scheduleOverride =
          "scheduleOverride" in changes ? changes.scheduleOverride : modified.scheduleOverride;
        const res = await api.admin.jobs[":id"].config.$post({
          param: { id },
          json: {
            enabled,
            scheduleOverride: scheduleOverride ?? null,
          },
        });
        if (!res.ok) throw new Error(`config update failed for ${id}`);
      }
    },
  }),
);
