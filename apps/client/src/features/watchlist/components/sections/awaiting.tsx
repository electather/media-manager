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
import { useAwaiting } from "../../hooks/use-awaiting";
import { useWatchlistPeek } from "../../hooks/use-watchlist-peek";

export function Awaiting() {
  const { items } = useAwaiting();
  const onPeek = useWatchlistPeek();
  if (items.length === 0) return null;
  return (
    <section className="mb-14">
      <SectionHead>
        <SectionHeadHeading>
          <SectionHeadEyebrow>
            {m.watchlist_section_eyebrow({ section: "awaiting" })}
          </SectionHeadEyebrow>
          <SectionHeadTitle>
            {m.watchlist_section_title({ section: "awaiting" })}
            <SectionHeadCount value={items.length} />
          </SectionHeadTitle>
        </SectionHeadHeading>
      </SectionHead>
      <VirtualGrid
        items={items}
        getKey={(it) => it.id}
        minColumnWidthPx={180}
        estimateRowHeight={() => 336}
        className="rounded-2xl border border-dashed border-input bg-card/40 p-5"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, color-mix(in oklab, var(--card) 88%, transparent) 0px, color-mix(in oklab, var(--card) 88%, transparent) 12px, color-mix(in oklab, var(--background) 92%, transparent) 12px, color-mix(in oklab, var(--background) 92%, transparent) 13px)",
        }}
        renderItem={(it) => (
          <div className="opacity-90 transition-opacity hover:opacity-100">
            <WatchlistCard item={it} forceAspect="2/3" onPeek={onPeek} />
          </div>
        )}
      />
    </section>
  );
}
