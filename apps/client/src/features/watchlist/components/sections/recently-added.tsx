import { ChevronRight, Film, Sparkles, Tv } from "lucide-react";
import * as m from "@/paraglide/messages";
import {
  SectionHead,
  SectionHeadCount,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import type { CompactMediaItem } from "@nama/shared/media";
import { sourceLabel } from "../../lib/types";
import { cn } from "@/shared/lib/utils";
import { useRecentlyAdded } from "../../hooks/use-recently-added";
import { useWatchlistPeek } from "../../hooks/use-watchlist-peek";

const MS_PER_MIN = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MIN;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_WEEK = 7 * MS_PER_DAY;

// fallow-ignore-next-line complexity
function relativeLabel(addedAt: number, now: number = Date.now()): string {
  const delta = Math.max(0, now - addedAt);
  if (delta < MS_PER_MIN) return m.watchlist_recent_time({ unit: "just_now", n: "" });
  if (delta < MS_PER_HOUR) {
    return m.watchlist_recent_time({
      unit: "minutes_ago",
      n: String(Math.floor(delta / MS_PER_MIN)),
    });
  }
  if (delta < MS_PER_DAY) {
    return m.watchlist_recent_time({
      unit: "hours_ago",
      n: String(Math.floor(delta / MS_PER_HOUR)),
    });
  }
  if (delta < 2 * MS_PER_DAY) return m.watchlist_recent_time({ unit: "yesterday", n: "" });
  if (delta < MS_PER_WEEK) {
    return m.watchlist_recent_time({ unit: "days_ago", n: String(Math.floor(delta / MS_PER_DAY)) });
  }
  return m.watchlist_recent_time({ unit: "last_week", n: "" });
}

export function RecentlyAdded() {
  const { items } = useRecentlyAdded();
  const onPeek = useWatchlistPeek();
  const top = items;
  if (top.length === 0) return null;
  return (
    <section className="mb-14">
      <SectionHead>
        <SectionHeadHeading>
          <SectionHeadEyebrow>
            {m.watchlist_section_eyebrow({ section: "recent" })}
          </SectionHeadEyebrow>
          <SectionHeadTitle>
            {m.watchlist_section_title({ section: "recent" })}
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
  item: CompactMediaItem;
  isFirst: boolean;
  onPeek: (id: string) => void;
}) {
  const Icon = item.mediaType === "movie" ? Film : Tv;
  const kindLabel = m.media_kind({ kind: item.mediaType });
  const src = item.backdrop ?? item.poster;
  return (
    <li className="list-none">
      <button
        type="button"
        onClick={() => onPeek(item.id)}
        className={cn(
          `grid w-full items-center gap-4 px-5 py-3.5 text-start transition-colors hover:bg-accent`,
          !isFirst && "border-t border-border",
        )}
        style={{ gridTemplateColumns: "110px 80px 1fr auto auto" }}
      >
        {/* Label is computed at render time; frozen between renders since there
            is no tick interval. Acceptable here: the strip re-mounts on route
            change and auto-refetches via the section's query stale time. */}
        <span className="font-mono text-xs uppercase tracking-[0.04em] text-muted-foreground">
          {item.addedAt != null ? relativeLabel(item.addedAt) : null}
        </span>
        <span className="relative h-11 w-20 overflow-hidden rounded-md bg-muted max-sm:hidden">
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
          {item.addedSource != null ? sourceLabel(item.addedSource) : null}
        </span>
        <span className="text-muted-foreground/70 max-sm:hidden">
          <ChevronRight aria-hidden="true" className="size-4" />
        </span>
      </button>
    </li>
  );
}
