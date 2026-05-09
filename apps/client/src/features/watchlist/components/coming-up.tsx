import * as m from "@/paraglide/messages";
import { Card } from "@/features/home/components/card";
import type { WatchlistItem } from "../lib/types";
import { SectionHead } from "./section-head";

interface ComingUpProps {
  items: readonly WatchlistItem[];
  onPeek: (id: string) => void;
}

export function ComingUp({ items, onPeek }: ComingUpProps) {
  if (items.length === 0) return null;
  return (
    <section className="mb-14">
      <SectionHead
        eyebrow={m.watchlist_section_coming_eyebrow()}
        title={m.watchlist_section_coming_title()}
        count={items.length}
      />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        {items.map((it) => (
          <CalCell key={it.id} item={it} onPeek={onPeek} />
        ))}
      </div>
    </section>
  );
}

function CalCell({ item, onPeek }: { item: WatchlistItem; onPeek: (id: string) => void }) {
  const date = item.relDate ?? item.facets?.releaseDate ?? "";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 border-b border-border pb-2 text-xs">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
        <span className="font-mono tracking-[0.04em] text-muted-foreground">{date}</span>
      </div>
      <Card item={item} rowKind="upcomingForYou" forceAspect="16/9" onClick={onPeek} />
    </div>
  );
}
