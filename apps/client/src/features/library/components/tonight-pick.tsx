import { Film, Tv } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Card } from "@/features/home/components/card";
import {
  SectionHead,
  SectionHeadActions,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import { Button } from "@/shared/ui/button";
import { Skeleton } from "@/shared/ui/skeleton";
import { shortRuntimeLabel } from "../lib/format";
import type { LibraryItem } from "../lib/types";

interface TonightPickProps {
  pick: LibraryItem;
  alternates: readonly LibraryItem[];
  onPeek: (id: string) => void;
}

export function TonightPick({ pick, alternates, onPeek }: TonightPickProps) {
  return (
    <section className="mb-14">
      <SectionHead>
        <SectionHeadHeading>
          <SectionHeadEyebrow>{m.library_tonight_eyebrow()}</SectionHeadEyebrow>
          <SectionHeadTitle>{m.library_tonight_title()}</SectionHeadTitle>
        </SectionHeadHeading>
        <SectionHeadActions>
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground/70">
            {m.library_tonight_caption()}
          </span>
        </SectionHeadActions>
      </SectionHead>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <div className="relative min-w-0">
          <Card
            item={{ ...pick, status: undefined }}
            rowKind="continueWatching"
            forceAspect="16/9"
            onClick={onPeek}
          />
          <div className="mt-3.5 flex items-center gap-2.5 font-mono text-xs tracking-[0.04em] text-muted-foreground">
            <span aria-hidden="true" className="inline-block size-1.5 rounded-full bg-primary" />
            <span>{m.library_tonight_why()} ·</span>
            <span className="text-foreground/85">{m.library_tonight_default_reason()}</span>
          </div>
        </div>

        <aside className="self-stretch rounded-2xl border border-border bg-card p-4">
          <div className="mb-3 pl-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {m.library_tonight_alternates_kicker()}
          </div>
          <ul className="m-0 flex flex-col gap-1 p-0">
            {alternates.map((it, idx) => (
              <AlternateRow key={it.id} item={it} index={idx} onPeek={onPeek} />
            ))}
          </ul>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3 w-full justify-center text-xs"
            disabled={alternates.length === 0}
            onClick={() => {
              if (alternates.length === 0) return;
              const idx = Math.floor(Math.random() * alternates.length);
              const choice = alternates[idx];
              if (choice) onPeek(choice.id);
            }}
          >
            {m.library_tonight_shuffle()}
          </Button>
        </aside>
      </div>
    </section>
  );
}

interface AlternateRowProps {
  item: LibraryItem;
  index: number;
  onPeek: (id: string) => void;
}

// fallow-ignore-next-line complexity
function AlternateRow({ item, index, onPeek }: AlternateRowProps) {
  const KindIcon = item.mediaType === "movie" ? Film : Tv;
  const src = item.backdrop ?? item.poster;
  return (
    <li className="list-none">
      <button
        type="button"
        onClick={() => onPeek(item.id)}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-start transition-colors hover:bg-accent"
      >
        <span className="w-5.5 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/70">
          {String(index + 2).padStart(2, "0")}
        </span>
        <span className="relative h-9 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
          {src ? (
            <img
              src={src}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <Skeleton className="absolute inset-0" />
          )}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="line-clamp-1 text-sm font-medium text-foreground">{item.title}</span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
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
    </li>
  );
}
