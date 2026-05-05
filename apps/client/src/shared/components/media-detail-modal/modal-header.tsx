import { MediaMetaRow } from "@/shared/components/media-meta-row";
import type { MediaDetailItem } from "./types";

type Props = {
  item: MediaDetailItem;
  titleId: string;
};

export function ModalHeader({ item, titleId }: Props) {
  return (
    <header className="flex flex-col gap-3 px-6 pt-6 sm:px-10 sm:pt-10">
      <ModalTitle item={item} titleId={titleId} />
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

function ModalTitle({ item, titleId }: Props) {
  if (item.clearLogoText) {
    return (
      <h2
        id={titleId}
        aria-label={item.title}
        className="scroll-driven-title font-mono text-2xl font-bold tracking-[0.18em] text-foreground sm:text-4xl"
      >
        {item.clearLogoText}
      </h2>
    );
  }
  return (
    <h2
      id={titleId}
      className="scroll-driven-title font-heading text-2xl font-semibold text-foreground sm:text-4xl"
    >
      {item.title}
    </h2>
  );
}
