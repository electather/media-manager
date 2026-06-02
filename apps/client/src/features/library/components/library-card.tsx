import { memo } from "react";
import * as m from "@/paraglide/messages";
import { MediaCardMeta, MediaCardSubtitle, MediaCardTitle } from "@/shared/components/media-card";
import { MediaRowCard } from "@/shared/components/media-row-card";
import { buildMediaHref } from "@/shared/lib/media-id";
import { kindLabel } from "../lib/labels";
import type { LibraryItem } from "../lib/types";

const progressLabel = (percent: number) => m.library_card_progress({ percent: String(percent) });

/** How many quality chips a tile shows before truncating (keeps the footer tidy). */
const MAX_TAGS = 3;

/**
 * Quality-tier chips read off `CompactMediaItem.tags` (e.g. `4K HDR`, `Atmos`).
 * The mock left `tags` undefined so nothing rendered; the real endpoints now
 * surface them. Bordered monospaced chips match the home feed's tag treatment
 * so the library inherits the same token styling.
 */
function QualityChips({ tags }: { tags: string[] | undefined }) {
  if (!tags?.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {tags.slice(0, MAX_TAGS).map((tag) => (
        <span
          key={tag}
          className="rounded border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-xs tracking-wide text-muted-foreground"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

/**
 * One library tile. Reuses the shared `MediaRowCard` (grid variant: 2/3 poster
 * with a title + year footer) and links to the existing detail route, so the
 * library inherits the exact card treatment the home feed and watchlist use. The
 * footer adds the quality chips beneath the title/year.
 *
 * `memo` because the lenses render many of these; the props are stable per item.
 */
export const LibraryCard = memo(function LibraryCard({ item }: { item: LibraryItem }) {
  return (
    <MediaRowCard
      item={item}
      variant="grid"
      href={buildMediaHref(item.id) ?? undefined}
      openLabel={m.library_card_open({ title: item.title })}
      kindLabel={kindLabel(item.mediaType)}
      progressLabel={progressLabel}
      meta={
        <MediaCardMeta>
          <MediaCardTitle>{item.title}</MediaCardTitle>
          {item.year ? <MediaCardSubtitle>{item.year}</MediaCardSubtitle> : null}
          <QualityChips tags={item.tags} />
        </MediaCardMeta>
      }
    />
  );
});
