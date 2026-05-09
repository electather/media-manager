import { ChevronRight, Film, Tv } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Card } from "@/features/home/components/card";
import { shortRuntime } from "../lib/runtime";
import type { WatchlistItem } from "../lib/types";
import { SectionHead } from "./section-head";

interface TonightPickProps {
  pick: WatchlistItem | null;
  alternates: readonly WatchlistItem[];
  onPeek: (id: string) => void;
  onShuffle: () => void;
}

export function TonightPick({ pick, alternates, onPeek, onShuffle }: TonightPickProps) {
  if (!pick) return null;
  return (
    <section className="mb-14">
      <SectionHead
        eyebrow={m.watchlist_section_tonight_eyebrow()}
        title={m.watchlist_section_tonight_title()}
        accessory={
          <div className="font-mono text-[11px] tracking-[0.06em] text-muted-foreground/70 uppercase">
            {m.watchlist_section_tonight_accessory()}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(280px,360px)] lg:gap-8">
        <div className="relative min-w-0">
          <Card item={pick} rowKind="yourWatchlist" forceAspect="16/9" onClick={onPeek} />
          <div className="mt-3.5 flex items-center gap-2.5 font-mono text-xs tracking-[0.04em] text-muted-foreground">
            <span className="text-primary">●</span>
            <span>{m.watchlist_tonight_why()} ·</span>
            <span className="text-foreground/85">
              {pick.matchReasonText ?? m.watchlist_tonight_default_reason()}
            </span>
          </div>
        </div>

        <aside className="flex flex-col rounded-xl border border-border bg-card p-4">
          <div className="mb-3.5 ps-0.5 font-mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase">
            {m.watchlist_tonight_alternates_label()}
          </div>
          <ul className="flex flex-col gap-1">
            {alternates.map((it, idx) => (
              <li key={it.id}>
                <AlternateRow item={it} index={idx + 2} onPeek={onPeek} />
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-4 w-full justify-center text-xs"
            onClick={onShuffle}
          >
            {m.watchlist_tonight_shuffle()}
          </Button>
        </aside>
      </div>
    </section>
  );
}

function AlternateRow({
  item,
  index,
  onPeek,
}: {
  item: WatchlistItem;
  index: number;
  onPeek: (id: string) => void;
}) {
  const KindIcon = item.mediaType === "movie" ? Film : Tv;
  return (
    <button
      type="button"
      onClick={() => onPeek(item.id)}
      className="flex w-full cursor-pointer items-center gap-3 rounded-lg p-2 text-start transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="w-6 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/70">
        {String(index).padStart(2, "0")}
      </span>
      <div className="aspect-video h-9 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
        {item.backdrop ? (
          <img
            src={item.backdrop}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <KindIcon aria-hidden="true" className="size-3" />
          <span>{shortRuntime(item)}</span>
          {item.year ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{item.year}</span>
            </>
          ) : null}
        </div>
      </div>
      <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/70" />
    </button>
  );
}
