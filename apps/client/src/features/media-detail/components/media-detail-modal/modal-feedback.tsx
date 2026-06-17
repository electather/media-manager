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
        {/* Vote and note persistence is not yet wired; buttons use aria-disabled
            so they stay in the tab order and are announced as unavailable.
            No onClick is wired — activation is silently suppressed. */}
        {/* restore active={computed} + onClick when vote persistence lands */}
        <VoteButton
          active={false}
          ariaDisabled
          tone="up"
          label={m.home_detail_feedback_like()}
          icon={<ThumbsUp className="size-3.5" />}
        />
        <VoteButton
          active={false}
          ariaDisabled
          tone="down"
          label={m.home_detail_feedback_dislike()}
          icon={<ThumbsDown className="size-3.5" />}
        />
        <NoteButton hasNote={hasNote} disabled />
        <span className="flex items-center gap-1.5 font-mono text-[11px] tracking-[0.02em] text-muted-foreground/60">
          <Sparkles className="size-2.5" aria-hidden="true" />
          {m.home_detail_feedback_tagline()}
        </span>
      </div>
    </div>
  );
}

// fallow-ignore-next-line complexity
function VoteButton({
  active,
  ariaDisabled,
  tone,
  label,
  icon,
}: {
  active: boolean;
  ariaDisabled?: boolean;
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
      aria-disabled={ariaDisabled || undefined}
      aria-pressed={active}
      className={cn(
        "flex h-[34px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium backdrop-blur-sm transition-all",
        active
          ? activeClass
          : // hover:* applies when vote persistence is wired and ariaDisabled is removed.
            "border-border bg-foreground/6 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
        ariaDisabled && "cursor-not-allowed opacity-50 pointer-events-none",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

// fallow-ignore-next-line complexity
function NoteButton({ hasNote, disabled }: { hasNote: boolean; disabled?: boolean }) {
  return (
    // Note persistence is not yet wired; aria-disabled keeps the button in the
    // tab order so keyboard and screen-reader users can discover it.
    // No onClick is wired — activation is silently suppressed. Restore when persistence lands.
    <button
      type="button"
      aria-disabled={disabled || undefined}
      aria-label={
        hasNote ? m.home_detail_feedback_note_edit_label() : m.home_detail_feedback_note_add_label()
      }
      className={cn(
        "flex h-[34px] items-center gap-1.5 rounded-full border px-3 text-xs font-medium backdrop-blur-sm transition-all",
        // Use muted style regardless of hasNote — primary accent on a disabled button
        // looks interactive but never responds. When note persistence lands, restore:
        //   hasNote → active accent colors + hover:bg-muted/40 hover:text-foreground
        //   !hasNote → same muted base + hover:bg-muted/40 hover:text-foreground
        "border-border bg-foreground/6 text-muted-foreground",
        disabled && "cursor-not-allowed opacity-50 pointer-events-none",
      )}
    >
      <MessageSquare className="size-3.5" aria-hidden="true" />
      {hasNote ? m.home_detail_feedback_note_added() : m.home_detail_feedback_note()}
    </button>
  );
}
