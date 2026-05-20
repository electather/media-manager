import { useMemo } from "react";
import { ChevronRight, Film, Sparkles, Tv } from "lucide-react";
import * as m from "@/paraglide/messages";
import {
  SectionHead,
  SectionHeadCount,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import { sourceLabel } from "../lib/types";
import type { WatchlistItem } from "../lib/types";

interface RecentlyAddedProps {
  items: readonly WatchlistItem[];
  onPeek: (id: string) => void;
}

const MAX_ROWS = 5;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;

function relativeLabel(addedAt: number, now: number = Date.now()): string {
  const delta = now - addedAt;
  if (delta < MS_PER_HOUR) return m.watchlist_recent_time_hours_ago({ n: "1" });
  if (delta < MS_PER_DAY) {
    return m.watchlist_recent_time_hours_ago({ n: String(Math.floor(delta / MS_PER_HOUR)) });
  }
  if (delta < 2 * MS_PER_DAY) return m.watchlist_recent_time_yesterday();
  if (delta < MS_PER_WEEK) {
    return m.watchlist_recent_time_days_ago({ n: String(Math.floor(delta / MS_PER_DAY)) });
  }
  return m.watchlist_recent_time_last_week();
}

export function RecentlyAdded({ items, onPeek }: RecentlyAddedProps) {
  const top = useMemo(() => items.slice(0, MAX_ROWS), [items]);
  if (top.length === 0) return null;
  return (
    <section className="mb-14">
      <SectionHead>
        <SectionHeadHeading>
          <SectionHeadEyebrow>{m.watchlist_recent_eyebrow()}</SectionHeadEyebrow>
          <SectionHeadTitle>
            {m.watchlist_recent_title()}
            <SectionHeadCount value={top.length} />
          </SectionHeadTitle>
        </SectionHeadHeading>
      </SectionHead>
      <ul className="m-0 overflow-hidden rounded-2xl border border-border bg-card p-0">
        {top.map((item, idx) => (
          <RecentRow key={item.id} item={item} isFirst={idx === 0} onPeek={onPeek} />
        ))}
      </ul>
    </section>
  );
}

// fallow-ignore-next-line complexity
function RecentRow({
  item,
  isFirst,
  onPeek,
}: {
  item: WatchlistItem;
  isFirst: boolean;
  onPeek: (id: string) => void;
}) {
  const Icon = item.mediaType === "movie" ? Film : Tv;
  const kindLabel = item.mediaType === "movie" ? m.watchlist_kind_movie() : m.watchlist_kind_tv();
  const src = item.backdrop ?? item.poster;
  return (
    <li className="list-none">
      <button
        type="button"
        onClick={() => onPeek(item.id)}
        className={`grid w-full items-center gap-4 px-5 py-3.5 text-start transition-colors hover:bg-accent ${
          isFirst ? "" : "border-t border-border"
        }`}
        style={{ gridTemplateColumns: "110px 80px 1fr auto auto" }}
      >
        <span className="font-mono text-[11px] uppercase tracking-[0.04em] text-muted-foreground">
          {relativeLabel(item.addedAt)}
        </span>
        <span className="relative h-[45px] w-20 overflow-hidden rounded-md bg-muted max-sm:hidden">
          {src ? (
            <img
              src={src}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 size-full object-cover"
            />
          ) : null}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-medium text-foreground">{item.title}</span>
          <span className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Icon aria-hidden="true" className="size-3" />
            <span>{kindLabel}</span>
            {item.year ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{item.year}</span>
              </>
            ) : null}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 font-mono text-[11px] tracking-[0.03em] text-accent-foreground max-sm:hidden">
          <Sparkles aria-hidden="true" className="size-3" />
          {sourceLabel(item.addedSource)}
        </span>
        <span className="text-muted-foreground/70 max-sm:hidden">
          <ChevronRight aria-hidden="true" className="size-4" />
        </span>
      </button>
    </li>
  );
}
