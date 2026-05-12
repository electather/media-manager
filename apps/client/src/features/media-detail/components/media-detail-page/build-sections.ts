import * as m from "@/paraglide/messages";
import type { HomeMediaItem } from "@/features/home/lib/types";
import type { DetailSection as Section } from "../detail-section-nav";

export function buildSections(item: HomeMediaItem | null): Section[] {
  if (!item) return [];
  const castCount = (item.cast?.length ?? 0) + (item.director ? 1 : 0);
  const seasonCount = item.seasons?.length ?? 0;
  const sections: (Section | null)[] = [
    { id: "overview", label: m.media_detail_section_overview() },
    castCount > 0 ? { id: "cast", label: m.media_detail_section_cast(), count: castCount } : null,
    seasonCount > 0
      ? { id: "seasons", label: m.media_detail_section_seasons(), count: seasonCount }
      : null,
    { id: "your-take", label: m.media_detail_section_your_take() },
    { id: "related", label: m.media_detail_section_related() },
  ];
  return sections.filter((section): section is Section => section !== null);
}
