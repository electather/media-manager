import { ChevronRight, Film, Sparkles, Tv } from "lucide-react";
import * as m from "@/paraglide/messages";
import type { RecentLogEntry, WatchlistItem } from "../lib/types";
import { SectionHead } from "./section-head";

interface RecentlyAddedProps {
  entries: readonly RecentLogEntry[];
  onPeek: (id: string) => void;
}

/**
 * Audit-trail list: timestamp, thumbnail, title/kind, source badge, jump
 * affordance. Renders as a single bordered surface with row separators —
 * not a grid — so it reads as a continuous log rather than a card stack.
 */
export function RecentlyAdded({ entries, onPeek }: RecentlyAddedProps) {
  if (entries.length === 0) return null;
  return (
    <section className="mb-14">
      <SectionHead
        eyebrow={m.watchlist_section_recent_eyebrow()}
        title={m.watchlist_section_recent_title()}
        count={entries.length}
      />
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {entries.map((entry, idx) => (
          <RecentRow
            key={`${entry.item.id}-${entry.added}`}
            entry={entry}
            isFirst={idx === 0}
            onPeek={onPeek}
          />
        ))}
      </div>
    </section>
  );
}

function RecentRow({
  entry,
  isFirst,
  onPeek,
}: {
  entry: RecentLogEntry;
  isFirst: boolean;
  onPeek: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPeek(entry.item.id)}
      className={`grid w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-start transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[7rem_5rem_1fr_auto_auto] sm:gap-4 ${
        isFirst ? "" : "border-t border-border"
      }`}
    >
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
        {entry.added}
      </span>
      <RecentThumb item={entry.item} />
      <RecentTitle item={entry.item} />
      <RecentSource source={entry.source} />
      <ChevronRight aria-hidden="true" className="size-3.5 text-muted-foreground/70" />
    </button>
  );
}

function RecentThumb({ item }: { item: WatchlistItem }) {
  return (
    <div className="hidden aspect-video w-20 overflow-hidden rounded-md bg-muted sm:block">
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
  );
}

function RecentTitle({ item }: { item: WatchlistItem }) {
  const KindIcon = item.mediaType === "movie" ? Film : Tv;
  const kindLabel = item.mediaType === "movie" ? m.watchlist_kind_movie() : m.watchlist_kind_tv();
  return (
    <div className="min-w-0">
      <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <KindIcon aria-hidden="true" className="size-3" />
        <span>{kindLabel}</span>
        {item.year ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{item.year}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function RecentSource({ source }: { source: string }) {
  return (
    <span className="hidden items-center gap-1 rounded-full border border-border bg-muted px-2 py-1 font-mono text-[11px] tracking-[0.04em] text-muted-foreground sm:inline-flex">
      <Sparkles aria-hidden="true" className="size-3" />
      {source}
    </span>
  );
}
