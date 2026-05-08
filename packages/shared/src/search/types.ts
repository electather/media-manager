import type { z } from "zod";
import type { searchKindSchema, searchQuerySchema, searchResponseSchema } from "./schemas";

export type SearchKind = z.infer<typeof searchKindSchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type SearchResponse = z.infer<typeof searchResponseSchema>;
