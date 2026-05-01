import { Film, Tv } from "lucide-react";
import { m } from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";
import { buttonVariants } from "@/shared/ui/button";

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
        buttonVariants({ variant: "outline", size: "icon-xs" }),
        "pointer-events-none absolute top-2.5 inset-e-2.5 z-3",
        className,
      )}
    >
      <Icon />
    </span>
  );
}
