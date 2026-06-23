/** Root for all jobs queries; single `invalidateQueries({ queryKey: jobsKeys.all })` clears all cached resources. */
export const jobsKeys = {
  all: ["admin", "jobs"] as const,
} as const;
