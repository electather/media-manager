import { FileText, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";

type Props = {
  sectionRef: React.RefObject<HTMLDivElement | null>;
  taRef: React.RefObject<HTMLTextAreaElement | null>;
  note: string;
  editing: boolean;
  setEditing: (v: boolean) => void;
  onSave: (text: string) => void;
};

export function ModalNote({ sectionRef, taRef, note, editing, setEditing, onSave }: Props) {
  const [draft, setDraft] = useState(note);

  useEffect(() => {
    if (editing) setDraft(note);
  }, [editing, note]);

  const save = () => {
    onSave(draft.trim());
    setEditing(false);
  };

  const cancel = () => {
    setDraft(note);
    setEditing(false);
  };

  return (
    <div ref={sectionRef} className="px-6 sm:px-10">
      {editing ? (
        <div className="rounded-xl border border-border bg-card/80 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                {m.home_detail_note_label()}
              </span>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.04em] text-muted-foreground/60">
              <Sparkles className="size-2.5" aria-hidden="true" />
              <span>{m.home_detail_note_sentiment()}</span>
            </div>
          </div>
          <textarea
            ref={taRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={m.home_detail_note_placeholder()}
            rows={3}
            className="w-full resize-y rounded-lg border border-border bg-background/50 px-2.5 py-2 text-sm leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-border/80"
          />
          <div className="mt-2 flex justify-end gap-2">
            {note && (
              <Button variant="ghost" size="sm" onClick={cancel}>
                {m.home_detail_note_cancel()}
              </Button>
            )}
            <Button size="sm" onClick={save}>
              {m.home_detail_note_save()}
            </Button>
          </div>
        </div>
      ) : note ? (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-card/80 px-4 py-3">
          <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
              {m.home_detail_note_label()}
            </div>
            <p className="whitespace-pre-wrap text-sm text-foreground">{note}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
            aria-label={m.home_detail_note_edit_label()}
          >
            {m.home_detail_note_edit()}
          </Button>
        </div>
      ) : (
        // Note persistence is not yet wired; the add-note affordance is
        // disabled to prevent silent discard of user input on close/reopen.
        // onClick omitted — disabled buttons never fire; restore when persistence lands.
        <button
          type="button"
          disabled
          className="w-full cursor-not-allowed rounded-xl border border-dashed border-border/60 bg-card/60 px-4 py-3 text-left text-sm text-muted-foreground/70 opacity-50"
        >
          <span className="flex items-center gap-2">
            <FileText className="size-4 shrink-0" aria-hidden="true" />
            {m.home_detail_note_add_prompt()}
          </span>
        </button>
      )}
    </div>
  );
}
