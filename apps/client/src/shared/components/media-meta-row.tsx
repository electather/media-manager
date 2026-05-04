import { Star } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/utils";

export type MediaMetaRowProps = {
  year?: number;
  runtime?: string;
  ageRating?: string;
  rating?: number;
  genres?: string[];
  className?: string;
};

export function MediaMetaRow({
  year,
  runtime,
  ageRating,
  rating,
  genres,
  className,
}: MediaMetaRowProps) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-3 text-sm text-muted-foreground", className)}
    >
      <YearText value={year} />
      <RuntimeText value={runtime} />
      <AgeRatingBadge value={ageRating} />
      <RatingPill value={rating} />
      <GenresText value={genres} />
    </div>
  );
}

function YearText({ value }: { value?: number }) {
  if (value === undefined) return null;
  return <span>{value}</span>;
}

function RuntimeText({ value }: { value?: string }) {
  if (!value) return null;
  return (
    <>
      <span aria-hidden="true">·</span>
      <span>{value}</span>
    </>
  );
}

function AgeRatingBadge({ value }: { value?: string }) {
  if (!value) return null;
  return (
    <Badge variant="outline" className="font-medium">
      {value}
    </Badge>
  );
}

function RatingPill({ value }: { value?: number }) {
  if (value === undefined) return null;
  return (
    <span className="inline-flex items-center gap-1">
      <Star aria-hidden="true" className="size-3.5 fill-primary text-primary" />
      <span className="font-medium text-foreground">{value.toFixed(1)}</span>
    </span>
  );
}

function GenresText({ value }: { value?: string[] }) {
  if (!value || value.length === 0) return null;
  return <span aria-label={m.home_detail_genres_label()}>{value.join(" · ")}</span>;
}
