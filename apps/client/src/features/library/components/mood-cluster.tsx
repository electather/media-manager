import { Film, Tv } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { shortRuntimeLabel } from "../lib/format";
import type { LibraryItem, LibraryMood } from "../lib/types";

interface MoodClusterProps {
  mood: LibraryMood;
  items: readonly LibraryItem[];
  onPeek: (id: string) => void;
  onSeeAll: () => void;
}

export function MoodCluster({ mood, items, onPeek, onSeeAll }: MoodClusterProps) {
  if (items.length === 0) return null;
  const visible = items.slice(0, 3);
  const [hero, ...secondary] = visible;
  if (!hero) return null;
  const heroLabel = hero.clearLogoText ?? hero.title.toUpperCase();

  return (
    <article className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4">
      <header className="mb-3.5 flex items-baseline justify-between">
        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
            {m.library_mood_cluster_eyebrow()} · {String(items.length).padStart(2, "0")}
          </div>
          <h3 className="m-0 text-[22px] font-semibold leading-[1.05] tracking-[-0.02em] text-foreground">
            {m[mood.labelKey]()}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{m[mood.noteKey]()}</p>
        </div>
      </header>

      <div className="flex flex-col gap-2.5">
        <button
          type="button"
          onClick={() => onPeek(hero.id)}
          className="group/mood relative isolate block aspect-video overflow-hidden rounded-xl bg-muted text-start transition-transform duration-300 hover:scale-[1.005]"
        >
          {hero.backdrop || hero.poster ? (
            <img
              src={hero.backdrop ?? hero.poster}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 size-full object-cover"
            />
          ) : null}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/5 to-black/70"
          />
          <div className="absolute end-3.5 bottom-3 start-3.5">
            <div
              className="font-mono text-[13px] font-bold uppercase tracking-[0.16em] leading-none text-white"
              style={{ textShadow: "0 2px 18px oklch(0 0 0 / 0.6)" }}
            >
              {heroLabel}
            </div>
            <div className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] text-white/80">
              {hero.mediaType === "movie" ? (
                <Film aria-hidden="true" className="size-3" />
              ) : (
                <Tv aria-hidden="true" className="size-3" />
              )}
              <span>{shortRuntimeLabel(hero)}</span>
            </div>
          </div>
        </button>

        {secondary.map((it) => (
          <button
            key={it.id}
            type="button"
            onClick={() => onPeek(it.id)}
            className="flex items-center gap-3 rounded-lg p-1 text-start transition-colors hover:bg-accent"
          >
            <span className="relative h-10 w-[72px] shrink-0 overflow-hidden rounded-md bg-muted">
              {it.backdrop || it.poster ? (
                <img
                  src={it.backdrop ?? it.poster}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 size-full object-cover"
                />
              ) : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="line-clamp-1 text-sm font-medium text-foreground">{it.title}</span>
              <span className="mt-0.5 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {it.mediaType === "movie" ? (
                  <Film aria-hidden="true" className="size-3" />
                ) : (
                  <Tv aria-hidden="true" className="size-3" />
                )}
                <span>{shortRuntimeLabel(it)}</span>
                {it.year ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{it.year}</span>
                  </>
                ) : null}
              </span>
            </span>
          </button>
        ))}
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="mt-3 w-full justify-center text-xs"
        onClick={onSeeAll}
      >
        {m.library_mood_see_all({ n: String(items.length) })}
      </Button>
    </article>
  );
}
