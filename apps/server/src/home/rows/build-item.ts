import type { CompactMediaItem } from "@ent-mcp/shared/home";
import { toCompact, toStatusOrUndefined, type RawMediaItem } from "../compact";

interface ItemBuildContext {
  dataloader: {
    getStatusBatch(ids: string[]): Promise<Record<string, string | undefined>>;
  };
}

export async function buildItem(
  ctx: ItemBuildContext,
  item: RawMediaItem,
): Promise<CompactMediaItem | null> {
  const compact = toCompact(item);
  const map = await ctx.dataloader.getStatusBatch([compact.id]);
  const status = toStatusOrUndefined(map[compact.id]);
  if (status) compact.status = status;
  return compact;
}
