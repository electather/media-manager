import { useQuery } from "@tanstack/react-query";
import type { JobHandle, JobRunSummary } from "@ent-mcp/shared/jobs";
import { api } from "@/shared/lib/api";

export function useJobRuns(jobId: string | null) {
  return useQuery({
    enabled: !!jobId,
    queryKey: ["admin", "jobs", "detail.runs", jobId],
    refetchInterval: jobId ? 5_000 : false,
    meta: { persist: false },
    queryFn: async (): Promise<{ job: JobHandle; runs: JobRunSummary[] }> => {
      const res = await api.admin.jobs[":id"].$get({
        param: { id: jobId! },
        query: { limit: "30" },
      });
      if (!res.ok) throw new Error("failed to load runs");
      return (await res.json()) as { job: JobHandle; runs: JobRunSummary[] };
    },
  });
}
