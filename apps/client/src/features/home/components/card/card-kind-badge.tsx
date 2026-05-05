import { Film, Tv } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Badge } from "@/shared/ui/badge";
import type { HomeMediaItem } from "../../lib/types";

export function CardKindBadge({ item }: { item: HomeMediaItem }) {
  const isMovie = item.mediaType === "movie";
  const Icon = isMovie ? Film : Tv;
  const label = isMovie ? m.home_card_kind_movie() : m.home_card_kind_tv();
  return (
    <Badge
      variant="glass"
      title={label}
      aria-label={label}
      className="pointer-events-none absolute end-2 top-2 size-6 rounded-md p-0 [&>svg]:size-3.5!"
    >
      <Icon aria-hidden="true" className="size-3.5" />
    </Badge>
  );
}
