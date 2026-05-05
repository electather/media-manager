import { useId } from "react";
import { useIsMobile } from "@/shared/hooks/use-is-mobile";
import { Dialog, DialogContent } from "@/shared/ui/dialog";
import { Sheet, SheetContent } from "@/shared/ui/sheet";
import { ModalActions } from "./modal-actions";
import { ModalBackdrop } from "./modal-backdrop";
import { ModalCredits } from "./modal-credits";
import { ModalHeader } from "./modal-header";
import { ModalSeasons } from "./modal-seasons";
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
      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="bottom"
          aria-labelledby={titleId}
          className="h-[92svh] max-h-[92svh] gap-0 overflow-hidden rounded-t-3xl border-t-0 bg-card p-0"
        >
          {body}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-labelledby={titleId}
        aria-modal="true"
        className="fixed inset-x-0 bottom-0 top-[var(--header-height)] z-50 grid max-h-[calc(100vh-var(--header-height))] w-full max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-t-3xl bg-card p-0 ring-0 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-4xl"
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
    <article
      data-testid="media-detail-modal"
      className="modal-scroll relative flex h-full flex-col overflow-y-auto"
    >
      {item.backdrop ? <ModalBackdrop src={item.backdrop} /> : null}
      <div className="pt-32 sm:pt-48" />
      <ModalHeader item={item} titleId={titleId} />
      {item.overview ? (
        <p className="px-6 py-4 text-sm leading-relaxed text-muted-foreground sm:px-10 sm:text-base">
          {item.overview}
        </p>
      ) : null}
      <ModalActions item={item} inWatchlist={inWatchlist} onToggleWatchlist={onToggleWatchlist} />
      <ModalCredits item={item} />
      <ModalSeasons item={item} />
    </article>
  );
}
