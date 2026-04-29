import type { RowKind } from "@ent-mcp/shared/home";

export const homeKeys = {
  all: ["home"] as const,
  layout: () => [...homeKeys.all, "layout"] as const,
  rows: () => [...homeKeys.all, "rows"] as const,
  row: (rowId: RowKind, initialCursor: string | null) =>
    [...homeKeys.rows(), rowId, initialCursor] as const,
};
