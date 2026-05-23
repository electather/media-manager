import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
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

export function ComingUp() {
  const { items } = useComingUp();
  const navigate = useNavigate();
  const onPeek = useCallback(
    (id: string) => {
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, peek: id }),
        replace: false,
        resetScroll: false,
      });
    },
    [navigate],
  );
  if (items.length === 0) return null;
  return (
    <section className="mb-14">
      <SectionHead>
        <SectionHeadHeading>
          <SectionHeadEyebrow>{m.watchlist_coming_up_eyebrow()}</SectionHeadEyebrow>
          <SectionHeadTitle>
            {m.watchlist_coming_up_title()}
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
