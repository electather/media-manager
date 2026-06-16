import * as m from "@/paraglide/messages";
import { WatchlistCard } from "../watchlist-card";
import {
  SectionHead,
  SectionHeadCount,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import { VirtualGrid } from "@/shared/components/virtualized";
import { useComingUp } from "../../hooks/use-coming-up";
import { useWatchlistPeek } from "../../hooks/use-watchlist-peek";

export function ComingUp() {
  const { items } = useComingUp();
  const onPeek = useWatchlistPeek();
  if (items.length === 0) return null;
  return (
    <section className="mb-14">
      <SectionHead>
        <SectionHeadHeading>
          <SectionHeadEyebrow>
            {m.watchlist_section_eyebrow({ section: "coming_up" })}
          </SectionHeadEyebrow>
          <SectionHeadTitle>
            {m.watchlist_section_title({ section: "coming_up" })}
            <SectionHeadCount value={items.length} />
          </SectionHeadTitle>
        </SectionHeadHeading>
      </SectionHead>
      <VirtualGrid
        items={items}
        getKey={(it) => it.id}
        minColumnWidthPx={220}
        estimateRowHeight={() => 216}
        renderItem={(it) => <WatchlistCard item={it} forceAspect="16/9" onPeek={onPeek} />}
      />
    </section>
  );
}
