import { Film, Star, Tv } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Badge } from "@/shared/ui/badge";
import type { HomeMediaItem } from "@/features/home/lib/types";

type Props = {
  item: HomeMediaItem;
};

export function DetailMetaLine({ item }: Props) {
  const isMovie = item.mediaType === "movie";
  const Icon = isMovie ? Film : Tv;

  return (
    <div className="flex flex-wrap items-center gap-2.5 text-sm text-foreground/75">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 bg-black/45 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.04em] backdrop-blur-md">
        <Icon aria-hidden="true" className="size-3" />
        {isMovie ? m.home_card_kind_movie() : m.home_card_kind_tv()}
      </span>
      {item.year ? <span>{item.year}</span> : null}
      {item.runtime ? (
        <>
          <span aria-hidden="true" className="opacity-50">
            ·
          </span>
          <span>{item.runtime}</span>
        </>
      ) : null}
      {item.ageRating ? (
        <Badge variant="outline" className="font-medium">
          {item.ageRating}
        </Badge>
      ) : null}
      {item.genres && item.genres.length > 0 ? (
        <>
          <span aria-hidden="true" className="opacity-50">
            ·
          </span>
          <span aria-label={m.home_detail_genres_label()}>{item.genres.join(" · ")}</span>
        </>
      ) : null}
      {item.rating !== undefined ? (
        <span className="inline-flex items-center gap-1">
          <Star aria-hidden="true" className="size-3.5 fill-primary text-primary" />
          <span className="font-medium text-foreground">{item.rating.toFixed(1)}</span>
          {item.votes ? (
            <span className="text-xs text-muted-foreground">
              ({(item.votes / 1000).toFixed(1)}k)
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
