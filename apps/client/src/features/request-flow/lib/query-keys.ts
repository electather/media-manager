export const requestFlowKeys = {
  all: ["request-flow"] as const,
  targets: (mediaType: "movie" | "tv") => ["request-flow", "targets", mediaType] as const,
  history: () => ["request-flow", "history"] as const,
} as const;
