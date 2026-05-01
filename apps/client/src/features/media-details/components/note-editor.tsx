import { SparklesIcon, StickyNoteIcon } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { useDetailStore } from "../lib/use-detail-store";

interface NoteEditorProps {
  itemId: string;
  taRef?: RefObject<HTMLTextAreaElement | null>;
  editing?: boolean | undefined;
  setEditing?: (next: boolean) => void;
}

export function NoteEditor({
  itemId,
  taRef: externalTaRef,
  editing: externalEditing,
  setEditing: externalSetEditing,
}: NoteEditorProps) {
  const { notes, setNote, showToast } = useDetailStore();
  const existing = notes[itemId] ?? "";
  const [editingInternal, setEditingInternal] = useState(!existing);
  const editing = externalEditing != null ? externalEditing : editingInternal;
  const setEditing = externalSetEditing ?? setEditingInternal;
  const [draft, setDraft] = useState(existing);
  const localTaRef = useRef<HTMLTextAreaElement | null>(null);
  const taRef = externalTaRef ?? localTaRef;

  useEffect(() => {
    setDraft(existing);
    setEditing(!existing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  const save = () => {
    setNote(itemId, draft.trim());
    setEditing(false);
    showToast(
      draft.trim() ? m.media_details_note_saved_toast() : m.media_details_note_removed_toast(),
    );
  };
  const cancel = () => {
    setDraft(existing);
    setEditing(false);
  };

  if (!editing) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted px-3.5 py-3">
        <span className="mt-0.5 text-muted-foreground">
          <StickyNoteIcon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
            {m.media_details_note_label()}
          </div>
          <div className="text-[13px] whitespace-pre-wrap text-pretty text-foreground/80">
            {existing}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="px-2.5 py-1 text-xs"
          onClick={() => {
            setEditing(true);
            setTimeout(() => taRef.current?.focus(), 0);
          }}
        >
          {m.media_details_note_edit()}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-muted p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">
            <StickyNoteIcon className="size-3.5" />
          </span>
          <div className="text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
            {m.media_details_note_label()}
          </div>
        </div>
        <div className="inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.04em] text-muted-foreground/70 uppercase">
          <SparklesIcon className="size-2.5" />
          <span>{m.media_details_note_sentiment()}</span>
        </div>
      </div>
      <textarea
        ref={taRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={m.media_details_note_placeholder()}
        rows={3}
        className="w-full resize-y rounded-lg border border-border bg-card px-2.5 py-2 text-[13px] leading-relaxed text-foreground outline-none focus:border-input"
      />
      <div className="mt-2 flex justify-end gap-2">
        {existing && (
          <Button variant="ghost" size="sm" className="px-3 py-1.5 text-xs" onClick={cancel}>
            {m.media_details_note_cancel()}
          </Button>
        )}
        <Button size="sm" className="px-3 py-1.5 text-xs" onClick={save}>
          {m.media_details_note_save()}
        </Button>
      </div>
    </div>
  );
}
