import { Film, Tv } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { shortRuntimeLabel } from "../lib/format";
import type { WatchlistItem, WatchlistMood } from "../lib/types";

interface MoodClusterProps {
  mood: WatchlistMood;
  items: readonly WatchlistItem[];
  onPeek: (id: string) => void;
  onSeeAll: () => void;
}

export function MoodCluster({ mood, items, onPeek, onSeeAll }: MoodClusterProps) {
  if (items.length === 0) return null;
  const [hero, ...secondary] = items.slice(0, 3);
  if (!hero) return null;

  return (
    <article className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4">
      <MoodHeader mood={mood} count={items.length} />
      <div className="flex flex-col gap-2.5">
        <MoodHero item={hero} onPeek={onPeek} />
        {secondary.map((it) => (
          <MoodSecondary key={it.id} item={it} onPeek={onPeek} />
        ))}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="mt-3 w-full justify-center text-xs"
        onClick={onSeeAll}
      >
        {m.watchlist_mood_see_all({ n: String(items.length) })}
      </Button>
    </article>
  );
}

function MoodHeader({ mood, count }: { mood: WatchlistMood; count: number }) {
  return (
    <header className="mb-3.5 flex items-baseline justify-between">
      <div>
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
          {m.watchlist_mood_cluster_eyebrow()} · {String(count).padStart(2, "0")}
        </div>
        <h3 className="m-0 text-[22px] font-semibold leading-[1.05] tracking-[-0.02em] text-foreground">
          {m[mood.labelKey]()}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">{m[mood.noteKey]()}</p>
      </div>
    </header>
  );
}

// fallow-ignore-next-line complexity
function MoodHero({ item, onPeek }: { item: WatchlistItem; onPeek: (id: string) => void }) {
  const KindIcon = item.mediaType === "movie" ? Film : Tv;
  const src = item.backdrop ?? item.poster;
  const heroLabel = item.title.toUpperCase();
  return (
    <button
      type="button"
      onClick={() => onPeek(item.id)}
      className="relative isolate block aspect-video overflow-hidden rounded-xl bg-muted text-start transition-transform duration-300 hover:scale-[1.005]"
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-linear-to-b from-background/5 to-background/70"
      />
      <div className="absolute inset-e-3.5 bottom-3 inset-s-3.5">
        <div
          className="font-mono text-[13px] font-bold uppercase tracking-[0.16em] leading-none text-foreground"
          style={{ textShadow: "0 2px 18px oklch(0 0 0 / 0.6)" }}
        >
          {heroLabel}
        </div>
        <div className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-foreground/80">
          <KindIcon aria-hidden="true" className="size-3" />
          <span>{shortRuntimeLabel(item)}</span>
        </div>
      </div>
    </button>
  );
}

// fallow-ignore-next-line complexity
function MoodSecondary({ item, onPeek }: { item: WatchlistItem; onPeek: (id: string) => void }) {
  const KindIcon = item.mediaType === "movie" ? Film : Tv;
  const src = item.backdrop ?? item.poster;
  return (
    <button
      type="button"
      onClick={() => onPeek(item.id)}
      className="flex items-center gap-3 rounded-lg p-1 text-start transition-colors hover:bg-accent"
    >
      <span className="relative h-10 w-[72px] shrink-0 overflow-hidden rounded-md bg-muted">
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
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="line-clamp-1 text-sm font-medium text-foreground">{item.title}</span>
        <span className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <KindIcon aria-hidden="true" className="size-3" />
          <span>{shortRuntimeLabel(item)}</span>
          {item.year ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{item.year}</span>
            </>
          ) : null}
        </span>
      </span>
    </button>
  );
}
