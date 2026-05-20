import { useDeferredValue, useId, useRef, useState } from "react";
import { useIsMobile } from "@/shared/hooks/use-is-mobile";
import { Drawer, DrawerContent } from "@/shared/ui/drawer";
import { Dialog, DialogContent } from "@/shared/ui/dialog";
import { ModalActions } from "./modal-actions";
import { ModalBackdrop } from "./modal-backdrop";
import { ModalFeedback } from "./modal-feedback";
import { ModalCredits } from "./modal-credits";
import { ModalHeader } from "./modal-header";
import { ModalMatchReason } from "./modal-match-reason";
import { ModalNote } from "./modal-note";
import { ModalOverview } from "./modal-overview";
import { ModalScores } from "./modal-scores";
import { ModalSeasons } from "./modal-seasons";
import { ModalTags } from "./modal-tags";
import { ModalTopbar } from "./modal-topbar";
import { ModalTVAirInfo } from "./modal-tv-air-info";
import type { MediaDetailItem } from "./types";

export type { MediaDetailItem } from "./types";

type Props = {
  item: MediaDetailItem | null;
  open: boolean;
  onClose: () => void;
  inWatchlist: boolean;
  onToggleWatchlist: () => void;
  /** Optional callback to escalate the peek into the full media detail page. */
  onViewFullPage?: (item: MediaDetailItem) => void;
};

export function MediaDetailModal({
  item,
  open,
  onClose,
  inWatchlist,
  onToggleWatchlist,
  onViewFullPage,
}: Props) {
  const isMobile = useIsMobile();
  const titleId = useId();
  // `?peek=` toggles synchronously with router navigation, so back/forward
  // or rapid card clicks can flip `open` and `item` faster than the portal's
  // close animation completes. Deferring both lets React coalesce the
  // intermediate states so the portal isn't mounted → unmounted → remounted
  // in a single tick.
  const deferredOpen = useDeferredValue(open);
  const deferredItem = useDeferredValue(item);

  function handleOpenChange(next: boolean) {
    if (!next) onClose();
  }

  const body = deferredItem ? (
    <ModalBody
      key={deferredItem.id}
      item={deferredItem}
      titleId={titleId}
      inWatchlist={inWatchlist}
      onToggleWatchlist={onToggleWatchlist}
      onViewFullPage={onViewFullPage ? () => onViewFullPage(deferredItem) : undefined}
    />
  ) : null;

  if (isMobile) {
    return (
      <Drawer open={deferredOpen} onOpenChange={handleOpenChange} swipeDirection="down">
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
    <Dialog open={deferredOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-labelledby={titleId}
        aria-modal="true"
        showCloseButton={false}
        className="flex max-h-[90vh] w-[min(56rem,calc(100vw-2rem))] max-w-none sm:max-w-none flex-col gap-0 overflow-hidden rounded-2xl bg-card p-0 ring-1 ring-border"
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
  onViewFullPage,
}: {
  item: MediaDetailItem;
  titleId: string;
  inWatchlist: boolean;
  onToggleWatchlist: () => void;
  onViewFullPage?: () => void;
}) {
  const [note, setNote] = useState("");
  const [noteEditing, setNoteEditing] = useState(false);
  const noteSectionRef = useRef<HTMLDivElement>(null);
  const noteTaRef = useRef<HTMLTextAreaElement>(null);

  function jumpToNote() {
    noteSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setNoteEditing(true);
    // Double-rAF: the first frame applies the `editing` state, the second
    // waits for the textarea to be in the layout tree before we focus it.
    // Avoids a hardcoded ms timer racing the smooth-scroll on slow devices.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        noteTaRef.current?.focus();
      });
    });
  }

  return (
    <div className="modal-backdrop-timeline-scope relative isolate flex flex-1 min-h-0 flex-col overflow-hidden">
      {item.backdrop ? <ModalBackdrop src={item.backdrop} /> : null}
      <article
        data-testid="media-detail-modal"
        className="modal-scroll modal-backdrop-timeline-source relative flex flex-1 min-h-0 flex-col overflow-x-hidden overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <ModalTopbar item={item} onViewFullPage={onViewFullPage} />
        {/* Hero spacer keeps the cinematic backdrop visible above the content
            surface; height mirrors the prototype's modal-hero-spacer
            (240px mobile / 320px desktop minus topbar height). */}
        <div aria-hidden="true" className="h-28 shrink-0 sm:h-40" />
        <div className="relative flex flex-col gap-5 bg-linear-to-b from-transparent via-card/90 to-card pb-10 pt-6 sm:gap-6 sm:pt-8">
          <ModalHeader item={item} titleId={titleId} />
          <ModalFeedback hasNote={!!note} onNoteClick={jumpToNote} />
          <ModalActions
            item={item}
            inWatchlist={inWatchlist}
            onToggleWatchlist={onToggleWatchlist}
          />
          <ModalTVAirInfo item={item} />
          <ModalScores item={item} />
          <ModalTags item={item} />
          <ModalOverview item={item} />
          <ModalCredits item={item} />
          <ModalSeasons item={item} />
          <ModalMatchReason reason={item.matchReason} />
          <ModalNote
            sectionRef={noteSectionRef}
            taRef={noteTaRef}
            note={note}
            editing={noteEditing}
            setEditing={setNoteEditing}
            onSave={setNote}
          />
        </div>
      </article>
    </div>
  );
}
