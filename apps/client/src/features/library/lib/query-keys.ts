/** Hierarchical query-key factory for the library feature (skill rule 4). */
export const libraryKeys = {
  all: ["library"] as const,
  data: () => [...libraryKeys.all, "data"] as const,
} as const;
