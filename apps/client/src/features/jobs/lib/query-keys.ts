/** Query-key root for the jobs feature.
 *
 * Every React Query key for jobs is rooted at `jobsKeys.all` so that a single
 * `invalidateQueries({ queryKey: jobsKeys.all })` clears every cached jobs
 * resource. Per-resource members (e.g. `list`, `detail`) will be added here
 * alongside the query hooks that consume them.
 */
export const jobsKeys = {
  all: ["admin", "jobs"] as const,
} as const;
