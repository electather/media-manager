import * as m from "@/paraglide/messages";
import type { HomeMediaItem } from "@/features/home/lib/types";
import { DetailCastGrid } from "../detail-cast-grid";
import { DetailSection } from "../detail-section";

export function DetailCastSection({ item, hasCast }: { item: HomeMediaItem; hasCast: boolean }) {
  if (!hasCast) return null;
  return (
    <DetailSection id="cast" title={m.media_detail_section_cast()}>
      <DetailCastGrid item={item} />
    </DetailSection>
  );
}
