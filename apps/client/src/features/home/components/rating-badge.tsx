import { StarIcon } from "lucide-react";

interface RatingBadgeProps {
  rating: number | undefined;
}

export function RatingBadge({ rating }: RatingBadgeProps) {
  if (rating === undefined) return null;
  return (
    <span
      aria-label={`Your rating ${rating}`}
      className="absolute right-2 top-2 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white"
    >
      <StarIcon className="size-3" aria-hidden />
      {rating}
    </span>
  );
}
