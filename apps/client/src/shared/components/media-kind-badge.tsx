import { Film, Tv } from "lucide-react";
import { m } from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";

type MediaKindBadgeProps = {
  mediaType: "movie" | "tv";
  className?: string;
};

export function MediaKindBadge({ mediaType, className }: MediaKindBadgeProps) {
  const isMovie = mediaType === "movie";
  const label = isMovie ? m.media_card_kind_movie() : m.media_card_kind_tv();
  const Icon = isMovie ? Film : Tv;
  return (
    <span
      aria-label={label}
      title={label}
      className={cn(
        "absolute top-2.5 right-2.5 z-3 inline-flex size-6 items-center justify-center rounded-md bg-black/55 text-foreground backdrop-blur",
        className,
      )}
    >
      <Icon className="size-3.5" />
    </span>
  );
}
