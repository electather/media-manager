import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Film, Tv } from "lucide-react";
import * as m from "@/paraglide/messages";
import type { MoodId, WatchlistItem } from "@ent-mcp/shared/watchlist";
import { Button } from "@/shared/ui/button";
import {
  MediaRowBody,
  MediaRowMeta,
  MediaRowRoot,
  MediaRowThumb,
  MediaRowTitle,
} from "@/shared/components/media-row";
import { shortRuntimeLabel } from "../../../lib/format";
import { MOOD_REGISTRY } from "../../../lib/mood-registry";
import { useMoodCluster } from "../../../hooks/use-mood-cluster";
import { WatchlistCard } from "../../watchlist-card";

interface MoodClusterProps {
  moodId: MoodId;
  count: number;
}

const PREVIEW_LIMIT = 3;

export function MoodCluster({ moodId, count }: MoodClusterProps) {
  const { items } = useMoodCluster(moodId, PREVIEW_LIMIT);
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
  const onSeeAll = useCallback(() => {
    void navigate({ to: "/watchlist/moods/$moodId", params: { moodId } });
  }, [navigate, moodId]);
  if (items.length === 0) return null;
  const [hero, ...secondary] = items.slice(0, PREVIEW_LIMIT);
  if (!hero) return null;
  const copy = MOOD_REGISTRY[moodId];

  return (
    <article className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4">
      <header className="mb-3.5">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground/70">
          {m.watchlist_mood_cluster_eyebrow()} · {String(count).padStart(2, "0")}
        </div>
        <h3 className="m-0 text-[22px] font-semibold leading-[1.05] tracking-[-0.02em] text-foreground">
          {copy.label()}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">{copy.note()}</p>
      </header>
      <div className="flex flex-col gap-3">
        <WatchlistCard item={hero} forceAspect="16/9" onPeek={onPeek} />
        {secondary.length > 0 ? (
          <ul className="m-0 flex flex-col gap-1 p-0">
            {secondary.map((it) => (
              <li key={it.id} className="list-none">
                <MoodSecondaryRow item={it} onPeek={onPeek} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="mt-3 w-full justify-center text-xs"
        onClick={onSeeAll}
      >
        {m.watchlist_mood_see_all({ n: String(count) })}
      </Button>
    </article>
  );
}

function MoodSecondaryRow({ item, onPeek }: { item: WatchlistItem; onPeek: (id: string) => void }) {
  const KindIcon = item.mediaType === "movie" ? Film : Tv;
  const src = item.backdrop ?? item.poster;
  return (
    <MediaRowRoot onClick={() => onPeek(item.id)}>
      <MediaRowThumb src={src} alt="" aspect="16/9" widthClassName="w-[72px]" />
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
