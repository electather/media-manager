import { z } from "zod";
import { MEDIA_ID_REGEX } from "@ent-mcp/shared/media";

export const peekSchema = z.object({
  peek: z.string().regex(MEDIA_ID_REGEX).optional(),
});

export type PeekSearch = z.infer<typeof peekSchema>;
