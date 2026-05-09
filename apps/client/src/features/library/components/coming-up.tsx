import * as m from "@/paraglide/messages";
import { Card } from "@/features/home/components/card";
import type { LibraryItem } from "../lib/types";
import { SectionHead } from "./section-head";

interface ComingUpProps {
  items: readonly LibraryItem[];
  onPeek: (id: string) => void;
}

export function ComingUp({ items, onPeek }: ComingUpProps) {
  if (items.length === 0) return null;
  return (
    <section className="mb-14">
      <SectionHead
        eyebrow={m.library_coming_up_eyebrow()}
        title={m.library_coming_up_title()}
        count={items.length}
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
        {items.map((it) => {
          const date = it.facets?.releaseDate ?? m.library_coming_up_default_date();
          return (
            <div key={it.id} className="flex min-w-0 flex-col gap-3">
              <div className="flex items-center gap-2.5 border-b border-border pb-2 font-mono text-xs uppercase tracking-[0.04em] text-foreground/85">
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">{date}</span>
              </div>
              <Card item={it} rowKind="upcomingForYou" forceAspect="16/9" onClick={onPeek} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
