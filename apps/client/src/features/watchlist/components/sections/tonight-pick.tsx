import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Film, Tv } from "lucide-react";
import * as m from "@/paraglide/messages";
import {
  MediaRowBody,
  MediaRowMeta,
  MediaRowRoot,
  MediaRowThumb,
  MediaRowTitle,
} from "@/shared/components/media-row";
import {
  SectionHead,
  SectionHeadActions,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import type { CompactMediaItem } from "@nama/shared/media";
import { WatchlistCard } from "../watchlist-card";
import { shortRuntimeLabel } from "../../lib/format";
import { useTonight } from "../../hooks/use-tonight";

export function TonightPick() {
  const { items } = useTonight();
  const navigate = useNavigate();
  const onPeek = useCallback(
    (id: string) => {
      void navigate({
        to: ".",
        search: (prev) => ({ ...prev, peek: id }),
        replace: false,
        resetScroll: false,
      });
    },
    [navigate],
  );
  const [hero, ...alternates] = items;
  if (!hero) return null;

  return (
    <section className="mb-14">
      <SectionHead>
        <SectionHeadHeading>
          <SectionHeadEyebrow>
            {m.watchlist_section_eyebrow({ section: "tonight" })}
          </SectionHeadEyebrow>
          <SectionHeadTitle>{m.watchlist_section_title({ section: "tonight" })}</SectionHeadTitle>
        </SectionHeadHeading>
        <SectionHeadActions>
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground/70">
            {m.watchlist_tonight_caption()}
          </span>
        </SectionHeadActions>
      </SectionHead>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <WatchlistCard item={{ ...hero, status: undefined }} forceAspect="16/9" onPeek={onPeek} />
        {alternates.length > 0 ? (
          <aside className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 pl-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              {m.watchlist_tonight_alternates_kicker()}
            </div>
            <ul className="m-0 flex flex-col gap-1 p-0">
              {alternates.map((it, idx) => (
                <li key={it.id} className="list-none">
                  <AlternateRow item={it} index={idx} onPeek={onPeek} />
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>
    </section>
  );
}

interface AlternateRowProps {
  item: CompactMediaItem;
  index: number;
  onPeek: (id: string) => void;
}

function AlternateRow({ item, index, onPeek }: AlternateRowProps) {
  const KindIcon = item.mediaType === "movie" ? Film : Tv;
  const src = item.backdrop ?? item.poster;
  return (
    <MediaRowRoot onClick={() => onPeek(item.id)} className="px-2 py-2.5">
      <span className="w-5.5 shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/70">
        {String(index + 2).padStart(2, "0")}
      </span>
      <MediaRowThumb src={src} alt="" aspect="16/9" widthClassName="w-16" />
      <MediaRowBody>
        <MediaRowTitle>{item.title}</MediaRowTitle>
        <MediaRowMeta>
          <KindIcon aria-hidden="true" className="size-3" />
          <span>{shortRuntimeLabel(item)}</span>
          {item.year ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{item.year}</span>
            </>
          ) : null}
        </MediaRowMeta>
      </MediaRowBody>
    </MediaRowRoot>
  );
}
