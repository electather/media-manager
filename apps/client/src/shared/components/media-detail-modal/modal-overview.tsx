import type { MediaDetailItem } from "./types";

export function ModalOverview({ item }: { item: MediaDetailItem }) {
  if (!item.overview) return null;
  return (
    <p className="max-w-prose px-6 text-pretty text-sm leading-relaxed text-foreground/85 sm:px-10 sm:text-base">
      {item.overview}
    </p>
  );
}
