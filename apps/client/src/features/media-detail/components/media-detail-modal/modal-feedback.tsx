import { MessageSquare, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import * as m from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";

type Props = {
  hasNote: boolean;
};

export function ModalFeedback({ hasNote }: Props) {
  return (
    <div className="flex flex-col gap-2 px-6 sm:px-10">
      <span className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {m.home_detail_feedback_label()}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {/* Vote and note persistence is not yet wired; buttons are disabled to
            avoid misleading users into believing their input was saved. */}
        {/* restore active={computed} + onClick when vote persistence lands */}
        <VoteButton
          active={false}
          disabled
          tone="up"
          label={m.home_detail_feedback_like()}
          icon={<ThumbsUp className="size-3.5" />}
        />
        <VoteButton
          active={false}
          disabled
          tone="down"
          label={m.home_detail_feedback_dislike()}
          icon={<ThumbsDown className="size-3.5" />}
        />
        <NoteButton hasNote={hasNote} />
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
  disabled,
  tone,
  label,
  icon,
}: {
  active: boolean;
  disabled?: boolean;
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
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "flex h-[34px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium backdrop-blur-sm transition-all",
        active
          ? activeClass
          : // hover:* is inert on disabled buttons (pointer-events:none); kept
            // for when vote persistence is wired and the button is re-enabled.
            "border-border bg-foreground/6 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function NoteButton({ hasNote }: { hasNote: boolean }) {
  return (
    // Note persistence is not yet wired; disabled to avoid misleading users
    // into believing their input was saved across sessions.
    // onClick omitted — disabled buttons never fire; restore when persistence lands.
    <button
      type="button"
      disabled
      aria-label={
        hasNote ? m.home_detail_feedback_note_edit_label() : m.home_detail_feedback_note_add_label()
      }
      className={cn(
        "flex h-[34px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium backdrop-blur-sm transition-all",
        hasNote
          ? "border-primary/55 bg-primary/10 text-primary"
          : // hover:* is inert on disabled buttons (pointer-events:none); kept
            // for when note persistence is wired and the button is re-enabled.
            "border-border bg-foreground/6 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
        "cursor-not-allowed opacity-50",
      )}
    >
      <MessageSquare className="size-3.5" aria-hidden="true" />
      {hasNote ? m.home_detail_feedback_note_added() : m.home_detail_feedback_note()}
    </button>
  );
}
