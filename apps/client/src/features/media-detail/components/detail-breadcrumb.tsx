import { ChevronLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import * as m from "@/paraglide/messages";
import type { HomeMediaItem } from "@/features/home/lib/types";

type Props = {
  item: HomeMediaItem;
};

export function DetailBreadcrumb({ item }: Props) {
  const kindLabel =
    item.mediaType === "movie"
      ? m.media_detail_breadcrumb_movies()
      : m.media_detail_breadcrumb_tv();

  return (
    <nav
      aria-label={m.media_detail_breadcrumb_label()}
      className="mb-4 flex items-center gap-2 text-xs text-muted-foreground"
    >
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 rounded-md border border-foreground/10 bg-black/35 px-2 py-1 transition-colors hover:bg-black/55"
      >
        <ChevronLeft aria-hidden="true" className="size-3.5" />
        <span>{m.home_nav_home()}</span>
      </Link>
      <span aria-hidden="true" className="opacity-50">
        /
      </span>
      <span>{kindLabel}</span>
      <span aria-hidden="true" className="opacity-50">
        /
      </span>
      <span className="text-foreground/85">{item.title}</span>
    </nav>
  );
}
