import * as m from "@/paraglide/messages";
import { WatchlistCard } from "./watchlist-card";
import {
  SectionHead,
  SectionHeadCount,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import type { WatchlistItem } from "../lib/types";

interface ComingUpProps {
  items: readonly WatchlistItem[];
  onPeek: (id: string) => void;
}

export function ComingUp({ items, onPeek }: ComingUpProps) {
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
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        {items.map((it) => (
          <WatchlistCard
            key={it.id}
            item={it}
            rowKind="upcomingForYou"
            forceAspect="16/9"
            onPeek={onPeek}
          />
        ))}
      </div>
    </section>
  );
}
