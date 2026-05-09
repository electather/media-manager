import { useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Card } from "@/features/home/components/card";
import { Button } from "@/shared/ui/button";
import type { LibraryItem } from "../lib/types";
import { SectionHead } from "./section-head";

interface ReadyRowProps {
  items: readonly LibraryItem[];
  onPeek: (id: string) => void;
}

const SCROLL_AMOUNT = 480;

export function ReadyRow({ items, onPeek }: ReadyRowProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const scroll = useCallback((dir: -1 | 1) => {
    trackRef.current?.scrollBy({ left: dir * SCROLL_AMOUNT, behavior: "smooth" });
  }, []);

  if (items.length === 0) return null;

  return (
    <section className="mb-14">
      <SectionHead
        eyebrow={m.library_ready_eyebrow()}
        title={m.library_ready_title()}
        count={items.length}
        accessory={
          <>
            <Button
              variant="outline"
              size="icon"
              aria-label={m.library_ready_scroll_prev()}
              onClick={() => scroll(-1)}
            >
              <ChevronLeft aria-hidden="true" className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label={m.library_ready_scroll_next()}
              onClick={() => scroll(1)}
            >
              <ChevronRight aria-hidden="true" className="size-4" />
            </Button>
          </>
        }
      />
      <div
        ref={trackRef}
        className="row-track flex snap-x snap-proximity gap-4 overflow-x-auto overscroll-x-contain pb-1"
      >
        {items.map((it) => (
          <div key={it.id} className="w-[180px] shrink-0 snap-start sm:w-[200px]">
            <Card item={it} rowKind="yourWatchlist" forceAspect="2/3" onClick={onPeek} />
          </div>
        ))}
      </div>
    </section>
  );
}
