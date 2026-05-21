import { MessageSquare, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import { useState } from "react";
import * as m from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";

type Props = {
  hasNote: boolean;
  onNoteClick: () => void;
};

type Vote = "up" | "down" | null;

export function ModalFeedback({ hasNote, onNoteClick }: Props) {
  const [vote, setVote] = useState<Vote>(null);

  function toggleVote(id: "up" | "down") {
    setVote((prev) => (prev === id ? null : id));
  }

  return (
    <div className="flex flex-col gap-2 px-6 sm:px-10">
      <span className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {m.home_detail_feedback_label()}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <VoteButton
          active={vote === "up"}
          onClick={() => toggleVote("up")}
          tone="up"
          label={m.home_detail_feedback_like()}
          icon={<ThumbsUp className="size-3.5" />}
        />
        <VoteButton
          active={vote === "down"}
          onClick={() => toggleVote("down")}
          tone="down"
          label={m.home_detail_feedback_dislike()}
          icon={<ThumbsDown className="size-3.5" />}
        />
        <NoteButton hasNote={hasNote} onClick={onNoteClick} />
        <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.02em] text-muted-foreground/60">
          <Sparkles className="size-2.5" aria-hidden="true" />
          {m.home_detail_feedback_tagline()}
        </span>
      </div>
    </div>
  );
}

function VoteButton({
  active,
  onClick,
  tone,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  tone: "up" | "down";
  label: string;
  icon: React.ReactNode;
}) {
  const activeClass =
    tone === "up"
      ? "border-[oklch(0.55_0.13_155_/_0.55)] bg-[oklch(0.30_0.10_155_/_0.20)] text-[oklch(0.78_0.15_155)]"
      : "border-[oklch(0.60_0.16_25_/_0.55)] bg-[oklch(0.30_0.10_25_/_0.20)] text-[oklch(0.78_0.15_25)]";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium backdrop-blur-sm transition-all",
        active
          ? activeClass
          : "border-border bg-foreground/6 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function NoteButton({ hasNote, onClick }: { hasNote: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={
        hasNote ? m.home_detail_feedback_note_edit_label() : m.home_detail_feedback_note_add_label()
      }
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium backdrop-blur-sm transition-all",
        hasNote
          ? "border-primary/55 bg-primary/10 text-primary"
          : "border-border bg-foreground/6 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
      )}
    >
      <MessageSquare className="size-3.5" aria-hidden="true" />
      {hasNote ? m.home_detail_feedback_note_added() : m.home_detail_feedback_note()}
    </button>
  );
}
