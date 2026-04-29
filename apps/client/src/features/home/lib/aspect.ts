import type { CompactMediaItem } from "@ent-mcp/shared/home";

export type CardTreatment = "continue-watching" | "upcoming" | "default";
export type CardAspect = "16/9" | "2/3";

export function deriveTreatment(item: CompactMediaItem): CardTreatment {
  if (item.progress) return "continue-watching";
  if (item.episode) return "upcoming";
  return "default";
}

export function deriveAspect(
  item: CompactMediaItem,
  options: { isHero?: boolean; isThumb?: boolean } = {},
): CardAspect {
  if (item.progress || options.isHero || options.isThumb) return "16/9";
  return "2/3";
}
