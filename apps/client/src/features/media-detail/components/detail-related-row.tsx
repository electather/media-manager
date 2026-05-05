import { Row } from "@/features/home/components/row";
import type { HomeMediaItem } from "@/features/home/lib/types";
import { buildRelatedRow } from "../lib/related-items";

type Props = {
  item: HomeMediaItem;
  onCardClick: (id: string) => void;
};

export function DetailRelatedRow({ item, onCardClick }: Props) {
  const row = buildRelatedRow(item);
  if (row.items.length === 0) return null;
  return <Row row={row} onCardClick={onCardClick} />;
}
