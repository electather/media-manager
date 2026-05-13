import type { MediaDetailItem } from "./types";

type Props = {
  item: MediaDetailItem;
};

/**
 * Format-and-source chips below the score row. Mirrors the prototype's
 * mono-spaced uppercase tag treatment for short technical metadata
 * (e.g. "4K", "HDR", "Dolby Atmos").
 */
export function ModalTags({ item }: Props) {
  const tags = item.tags;
  if (!tags || tags.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5 px-6 sm:px-10">
      {tags.map((tag) => (
        <li
          key={tag}
          className="rounded-md border border-border bg-secondary/70 px-2 py-0.5 font-mono text-[11px] tracking-[0.02em] text-foreground/80"
        >
          {tag}
        </li>
      ))}
    </ul>
  );
}
