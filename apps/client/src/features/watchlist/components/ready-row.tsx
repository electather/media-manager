import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Card } from "@/features/home/components/card";
import type { WatchlistItem } from "../lib/types";
import { SectionHead } from "./section-head";

interface ReadyRowProps {
  items: readonly WatchlistItem[];
  onPeek: (id: string) => void;
}

export function ReadyRow({ items, onPeek }: ReadyRowProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  if (items.length === 0) return null;

  function scrollBy(delta: number) {
    trackRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  }

  return (
    <section className="mb-14">
      <SectionHead
        eyebrow={m.watchlist_section_ready_eyebrow()}
        title={m.watchlist_section_ready_title()}
        count={items.length}
        accessory={
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={m.watchlist_scroll_left()}
              onClick={() => scrollBy(-480)}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon-sm"
              aria-label={m.watchlist_scroll_right()}
              onClick={() => scrollBy(480)}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        }
      />
      <div
        ref={trackRef}
        className="row-track grid snap-x snap-proximity grid-flow-col gap-4 overflow-x-auto pb-1 [grid-auto-columns:minmax(11rem,12.5rem)]"
      >
        {items.map((it) => (
          <div key={it.id} className="snap-start">
            <Card item={it} rowKind="yourWatchlist" forceAspect="2/3" onClick={onPeek} />
          </div>
        ))}
      </div>
    </section>
  );
}
