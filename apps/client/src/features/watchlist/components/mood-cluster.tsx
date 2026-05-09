import { Film, Tv } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { shortRuntime } from "../lib/runtime";
import type { MoodGroup, WatchlistItem } from "../lib/types";

interface MoodClusterProps {
  mood: MoodGroup;
  onPeek: (id: string) => void;
  onSeeAll: () => void;
}

/**
 * Mood panel: an editorial card with a 16/9 hero on top and up to two thumb-
 * row tiles underneath. Mirrors the prototype's mosaic so each panel reads as
 * a curated mini-list rather than a cropped row.
 */
export function MoodCluster({ mood, onPeek, onSeeAll }: MoodClusterProps) {
  const visible = mood.items.slice(0, 3);
  if (visible.length === 0) return null;
  const hero = visible[0];
  if (!hero) return null;
  const tail = visible.slice(1);
  return (
    <article className="flex flex-col rounded-xl border border-border bg-card p-4">
      <header className="mb-3.5 flex items-baseline justify-between">
        <div>
          <div className="mb-1 font-mono text-[10px] tracking-[0.16em] text-muted-foreground/70 uppercase">
            {m.watchlist_mood_eyebrow({ n: String(mood.items.length).padStart(2, "0") })}
          </div>
          <h3 className="text-xl leading-[1.05] font-semibold tracking-tight text-foreground">
            {m[mood.labelKey]()}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{m[mood.noteKey]()}</p>
        </div>
      </header>
      <div className="flex flex-col gap-2.5">
        <MoodHero item={hero} onPeek={onPeek} />
        {tail.map((it) => (
          <MoodHorizontalRow key={it.id} item={it} onPeek={onPeek} />
        ))}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-3.5 w-full justify-center text-xs"
        onClick={onSeeAll}
      >
        {m.watchlist_mood_see_all({ n: String(mood.items.length) })}
      </Button>
    </article>
  );
}

function MoodHero({ item, onPeek }: { item: WatchlistItem; onPeek: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onPeek(item.id)}
      className="group/mood-hero relative aspect-video w-full cursor-pointer overflow-hidden rounded-lg bg-muted text-start transition-transform hover:scale-[1.005] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {item.backdrop ? (
        <img
          src={item.backdrop}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent"
      />
      <div className="absolute inset-x-3 bottom-3 flex flex-col gap-1.5">
        <div className="font-mono text-[13px] leading-none font-bold tracking-[0.16em] text-white drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)]">
          {item.clearLogoText ?? item.title.toUpperCase()}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-white/85">
          {item.mediaType === "movie" ? (
            <Film aria-hidden="true" className="size-3" />
          ) : (
            <Tv aria-hidden="true" className="size-3" />
          )}
          <span>{shortRuntime(item)}</span>
        </div>
      </div>
    </button>
  );
}

function MoodHorizontalRow({
  item,
  onPeek,
}: {
  item: WatchlistItem;
  onPeek: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPeek(item.id)}
      className="flex cursor-pointer items-center gap-3 rounded-md p-2 text-start transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="aspect-[2/3] h-16 w-11 shrink-0 overflow-hidden rounded-md bg-muted">
        {item.poster ? (
          <img
            src={item.poster}
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
          {item.mediaType === "movie" ? (
            <Film aria-hidden="true" className="size-3" />
          ) : (
            <Tv aria-hidden="true" className="size-3" />
          )}
          <span>{shortRuntime(item)}</span>
          {item.year ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{item.year}</span>
            </>
          ) : null}
        </div>
      </div>
    </button>
  );
}
