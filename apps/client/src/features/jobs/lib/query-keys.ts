/** Hierarchical query-key factory for the jobs feature.
 *
 * All React Query keys for jobs are rooted under `jobsKeys.all` so that
 * a single `invalidateQueries({ queryKey: jobsKeys.all })` clears every
 * cached jobs resource. Never use ad-hoc string arrays at call sites.
 */
export const jobsKeys = {
  all: ["admin", "jobs"] as const,
  list: () => [...jobsKeys.all, "list"] as const,
  runs: (jobId: string) => [...jobsKeys.all, "runs", jobId] as const,
} as const;
