import { Film, Tv } from "lucide-react";
import * as m from "@/paraglide/messages";
import type { HomeMediaItem } from "../../lib/types";

export function CardKindBadge({ item }: { item: HomeMediaItem }) {
  const isMovie = item.mediaType === "movie";
  const Icon = isMovie ? Film : Tv;
  const label = isMovie ? m.home_card_kind_movie() : m.home_card_kind_tv();
  return (
    <span
      title={label}
      aria-label={label}
      className="pointer-events-none absolute end-2 top-2 inline-flex size-6 items-center justify-center rounded-md bg-black/55 text-white backdrop-blur-md"
    >
      <Icon aria-hidden="true" className="size-3.5" />
    </span>
  );
}
