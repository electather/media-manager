import { z } from "zod";

export const PEEK_ID_REGEX = /^(movie|tv):\d+$/;

export const peekSchema = z.object({
  peek: z.string().regex(PEEK_ID_REGEX).optional(),
});

export type PeekSearch = z.infer<typeof peekSchema>;
