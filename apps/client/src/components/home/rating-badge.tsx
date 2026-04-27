import { StarIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function RatingBadge({ rating, className }: { rating: number; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[11px] font-medium leading-none text-white shadow-sm backdrop-blur-sm",
        className,
      )}
      aria-label={`Your rating: ${rating}`}
    >
      <StarIcon className="size-3" aria-hidden />
      {rating}
    </span>
  );
}
