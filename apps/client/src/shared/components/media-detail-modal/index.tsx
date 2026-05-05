import { useId } from "react";
import { useIsMobile } from "@/shared/hooks/use-is-mobile";
import { Drawer, DrawerContent } from "@/shared/ui/drawer";
import { Dialog, DialogContent } from "@/shared/ui/dialog";
import { ModalActions } from "./modal-actions";
import { ModalBackdrop } from "./modal-backdrop";
import { ModalCredits } from "./modal-credits";
import { ModalHeader } from "./modal-header";
import { ModalMatchReason } from "./modal-match-reason";
import { ModalOverview } from "./modal-overview";
import { ModalScores } from "./modal-scores";
import { ModalSeasons } from "./modal-seasons";
import { ModalTags } from "./modal-tags";
import { ModalTopbar } from "./modal-topbar";
import type { MediaDetailItem } from "./types";

export type { MediaDetailItem } from "./types";

type Props = {
  item: MediaDetailItem | null;
  open: boolean;
  onClose: () => void;
  inWatchlist: boolean;
  onToggleWatchlist: () => void;
};

export function MediaDetailModal({ item, open, onClose, inWatchlist, onToggleWatchlist }: Props) {
  const isMobile = useIsMobile();
  const titleId = useId();

  function handleOpenChange(next: boolean) {
    if (!next) onClose();
  }

  const body = item ? (
    <ModalBody
      key={item.id}
      item={item}
      titleId={titleId}
      inWatchlist={inWatchlist}
      onToggleWatchlist={onToggleWatchlist}
    />
  ) : null;

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={handleOpenChange} swipeDirection="down">
        <DrawerContent
          aria-labelledby={titleId}
          aria-modal="true"
          className="h-[92svh] max-h-[92svh] gap-0 overflow-hidden rounded-t-3xl border-t-0 bg-card p-0"
        >
          {body}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-labelledby={titleId}
        aria-modal="true"
        showCloseButton={false}
        className="flex max-h-[90vh] w-[min(48rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden rounded-2xl bg-card p-0 ring-1 ring-border"
      >
        {body}
      </DialogContent>
    </Dialog>
  );
}

function ModalBody({
  item,
  titleId,
  inWatchlist,
  onToggleWatchlist,
}: {
  item: MediaDetailItem;
  titleId: string;
  inWatchlist: boolean;
  onToggleWatchlist: () => void;
}) {
  return (
    <div className="relative isolate h-full overflow-hidden">
      {item.backdrop ? <ModalBackdrop src={item.backdrop} /> : null}
      <article
        data-testid="media-detail-modal"
        className="modal-scroll relative flex h-full flex-col overflow-x-hidden overflow-y-auto"
      >
        <ModalTopbar item={item} />
        {/* Hero spacer keeps the cinematic backdrop visible above the content
            surface; height mirrors the prototype's modal-hero-spacer
            (240px mobile / 320px desktop minus topbar height). */}
        <div aria-hidden="true" className="h-44 shrink-0 sm:h-64" />
        <div className="relative flex flex-col gap-5 bg-linear-to-b from-card/0 via-card/85 to-card pb-10 pt-6 sm:gap-6 sm:pt-8">
          <ModalHeader item={item} titleId={titleId} />
          <ModalActions item={item} inWatchlist={inWatchlist} onToggleWatchlist={onToggleWatchlist} />
          <ModalScores item={item} />
          <ModalTags item={item} />
          <ModalOverview item={item} />
          <ModalCredits item={item} />
          <ModalSeasons item={item} />
          <ModalMatchReason reason={item.matchReason} />
        </div>
      </article>
    </div>
  );
}
