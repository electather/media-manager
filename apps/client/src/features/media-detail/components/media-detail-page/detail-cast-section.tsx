import * as m from "@/paraglide/messages";
import type { HomeMediaItem } from "@/features/home/lib/types";
import { DetailCastGrid } from "../detail-cast-grid";
import { DetailSection } from "../detail-section";

export function DetailCastSection({ item }: { item: HomeMediaItem }) {
  const hasCast = (item.cast?.length ?? 0) > 0 || Boolean(item.director);
  if (!hasCast) return null;
  return (
    <DetailSection id="cast" title={m.media_detail_section_cast()}>
      <DetailCastGrid item={item} />
    </DetailSection>
  );
}
