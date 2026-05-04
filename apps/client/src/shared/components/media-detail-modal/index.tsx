import { useId } from "react";
import { Dialog, DialogContent } from "@/shared/ui/dialog";
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
  const titleId = useId();

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent
        aria-labelledby={titleId}
        aria-modal="true"
        role="dialog"
        className="fixed inset-x-0 bottom-0 top-12 z-50 grid max-h-[calc(100vh-3rem)] w-full max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-t-3xl bg-card p-0 ring-0 sm:left-1/2 sm:top-12 sm:-translate-x-1/2 sm:max-w-4xl"
      >
        {item ? (
          <ModalBody
            item={item}
            titleId={titleId}
            inWatchlist={inWatchlist}
            onToggleWatchlist={onToggleWatchlist}
          />
        ) : null}
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
