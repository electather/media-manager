import { z } from "zod";
import { ROW_KINDS } from "./enums";

/** `home.getLayout` takes no input. Strict empty schema rejects extra keys. */
export const homeGetLayoutInputSchema = z.object({}).strict();

/**
 * `home.getRowContent` input: client supplies a row id and the opaque cursor
 * it received on the previous page. Decoding/validating the cursor itself is
 * server-internal and lives outside `@ent-mcp/shared` (cursor schemas are not
 * exposed across the boundary).
 */
export const homeGetRowContentInputSchema = z
  .object({
    rowId: z.enum(ROW_KINDS),
    cursor: z.string().min(1),
  })
  .strict();

export type HomeGetLayoutInput = z.infer<typeof homeGetLayoutInputSchema>;
export type HomeGetRowContentInput = z.infer<typeof homeGetRowContentInputSchema>;
