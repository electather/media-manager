import { Layers } from "lucide-react";
import * as m from "@/paraglide/messages";
import type { HomeMediaItem } from "../../lib/types";
import { CardMatchReason } from "./card-match-reason";
import { CardTagChips } from "./card-tag-chips";

type Treatment = "cw" | "nextup" | "upcoming" | "default";

function treatmentFor(item: HomeMediaItem): Treatment {
  if (item.progress) return "cw";
  if (item.seriesContext) return "nextup";
  if (item.facets?.releaseDate) return "upcoming";
  return "default";
}

function formatSeries(item: HomeMediaItem): string | null {
  const s = item.seriesContext;
  if (!s) return null;
  const code = m.home_card_episode_label({ s: String(s.season), e: String(s.episode) });
  return s.episodeTitle ? `${code} · ${s.episodeTitle}` : code;
}

export function CardMeta({ item }: { item: HomeMediaItem }) {
  const t = treatmentFor(item);
  if (t === "cw") return <CardMetaProgress item={item} />;
  if (t === "nextup" || t === "upcoming") return <CardMetaUpcoming item={item} />;
  return <CardMetaDefault item={item} />;
}

function CardMetaDefault({ item }: { item: HomeMediaItem }) {
  return (
    <div className="mt-2 flex flex-col px-0.5">
      <p className="line-clamp-1 text-sm font-medium text-foreground">{item.title}</p>
      {item.year ? <p className="text-xs text-muted-foreground">{item.year}</p> : null}
      <CardMatchReason item={item} />
      <CardTagChips tags={item.tags} />
    </div>
  );
}

function CardMetaProgress({ item }: { item: HomeMediaItem }) {
  if (!item.progress) return null;
  const percent = Math.round((item.progress.watched / item.progress.total) * 100);
  return (
    <div className="mt-2 flex flex-col gap-0.5 px-0.5">
      <p className="line-clamp-1 text-sm font-medium text-foreground">{item.title}</p>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{m.home_card_progress_watched({ percent: String(percent) })}</span>
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Layers aria-hidden="true" className="size-3" />
          {item.progress.watched}/{item.progress.total}
        </span>
      </div>
      <CardMatchReason item={item} />
    </div>
  );
}

function CardMetaUpcoming({ item }: { item: HomeMediaItem }) {
  const series = formatSeries(item);
  const release = item.facets?.releaseDate ?? item.relDate ?? null;
  return (
    <div className="mt-2 flex flex-col px-0.5">
      <p className="line-clamp-1 text-sm font-medium text-foreground">{item.title}</p>
      {series || release ? (
        <p className="line-clamp-1 text-xs text-muted-foreground">
          {series}
          {series && release ? <span className="mx-1.5" aria-hidden="true">·</span> : null}
          {release ? <span className="font-medium text-primary">{release}</span> : null}
        </p>
      ) : null}
      <CardMatchReason item={item} />
    </div>
  );
}
