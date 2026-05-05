import { MediaMetaRow } from "@/shared/components/media-meta-row";
import type { MediaDetailItem } from "./types";

type Props = {
  item: MediaDetailItem;
  titleId: string;
};

/**
 * Hero header rendered over the cinematic backdrop. Uses the same
 * `scroll-driven-title` shrink animation the original modal had so the title
 * compacts as the body scrolls — the transform-origin is left so the
 * shrunken title aligns under the kind badge.
 */
export function ModalHeader({ item, titleId }: Props) {
  return (
    <header className="flex flex-col gap-3 px-6 sm:px-10">
      <ModalTitle item={item} titleId={titleId} />
      {/* Rating intentionally omitted — the score card below renders the
          aggregated rating with a star + vote count, so showing it here too
          would duplicate. Matches the prototype's modal meta line. */}
      <MediaMetaRow
        year={item.year}
        runtime={item.runtime}
        ageRating={item.ageRating}
        genres={item.genres}
        className="text-foreground/80 [text-shadow:0_2px_18px_oklch(0_0_0/0.45)]"
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
        className="scroll-driven-title font-mono text-3xl font-bold tracking-[0.18em] text-foreground [text-shadow:0_2px_18px_oklch(0_0_0/0.6)] sm:text-5xl"
      >
        {item.clearLogoText}
      </h2>
    );
  }
  return (
    <h2
      id={titleId}
      className="scroll-driven-title text-balance font-heading text-3xl font-semibold leading-[1.05] tracking-tight text-foreground [text-shadow:0_2px_18px_oklch(0_0_0/0.6)] sm:text-5xl"
    >
      {item.title}
    </h2>
  );
}
