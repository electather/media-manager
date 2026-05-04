import { MediaMetaRow } from "@/shared/components/media-meta-row";
import type { MediaDetailItem } from "./types";

type Props = {
  item: MediaDetailItem;
  titleId: string;
};

export function ModalHeader({ item, titleId }: Props) {
  const title = item.clearLogoText ?? item.title;
  return (
    <header className="flex flex-col gap-3 px-6 pt-6 sm:px-10 sm:pt-10">
      <h2
        id={titleId}
        className="scroll-driven-title font-mono text-2xl font-bold tracking-[0.18em] text-foreground sm:text-4xl"
      >
        {title}
      </h2>
      <MediaMetaRow
        year={item.year}
        runtime={item.runtime}
        ageRating={item.ageRating}
        rating={item.rating}
        genres={item.genres}
      />
    </header>
  );
}
