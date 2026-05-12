import { useRef, useState } from "react";
import * as m from "@/paraglide/messages";
import { ModalNote } from "@/shared/components/media-detail-modal/modal-note";
import { DetailSection } from "../detail-section";
import { UnpaddedModalSlot } from "./unpadded-modal-slot";

export function DetailYourTakeSection() {
  const [note, setNote] = useState("");
  const [noteEditing, setNoteEditing] = useState(false);
  const noteSectionRef = useRef<HTMLDivElement>(null);
  const noteTaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <DetailSection id="your-take" title={m.media_detail_section_your_take()}>
      <UnpaddedModalSlot>
        <ModalNote
          sectionRef={noteSectionRef}
          taRef={noteTaRef}
          note={note}
          editing={noteEditing}
          setEditing={setNoteEditing}
          onSave={setNote}
        />
      </UnpaddedModalSlot>
    </DetailSection>
  );
}
