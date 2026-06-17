import { MessageSquare, Sparkles, ThumbsDown, ThumbsUp } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
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
  disabled,
  tone,
  label,
  icon,
}: {
  active: boolean;
  /** Maps to aria-disabled, not the native disabled attribute. Keeps element in tab order. */
  disabled?: boolean;
  tone: "up" | "down";
  label: string;
  icon: React.ReactNode;
}) {
  const activeClass =
    tone === "up"
      ? "border-[oklch(0.55_0.13_155_/_0.55)] bg-[oklch(0.30_0.10_155_/_0.20)] text-[oklch(0.78_0.15_155)] hover:bg-[oklch(0.30_0.10_155_/_0.20)]" // hover:bg locks the active tint; prevents outline variant's hover:bg-muted from overriding
      : "border-[oklch(0.60_0.16_25_/_0.55)] bg-[oklch(0.30_0.10_25_/_0.20)] text-[oklch(0.78_0.15_25)] hover:bg-[oklch(0.30_0.10_25_/_0.20)]";

  return (
    <Button
      type="button"
      variant="outline"
      aria-disabled={disabled ? "true" : undefined}
      aria-pressed={active}
      className={cn(
        "h-[34px] rounded-full px-3 text-xs shadow-none backdrop-blur-sm",
        active
          ? activeClass
          : // hover:* applies when vote persistence is wired and disabled is removed.
            "border-border bg-foreground/6 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
        // pointer-events-none blocks hover styles (hover:bg-muted/40) that would
        // otherwise fire on mouse-over and create false affordance on an unavailable button.
        // Add cursor-not-allowed alongside an onClick guard when vote persistence lands.
        disabled && "opacity-50 pointer-events-none",
      )}
    >
      {icon}
      {label}
    </Button>
  );
}

// fallow-ignore-next-line complexity
function NoteButton({
  hasNote,
  disabled,
}: {
  hasNote: boolean;
  /** Maps to aria-disabled, not the native disabled attribute. Keeps element in tab order. */
  disabled?: boolean;
}) {
  return (
    // Note persistence is not yet wired; aria-disabled keeps the button in the
    // tab order so keyboard and screen-reader users can discover it.
    // No onClick is wired — activation is silently suppressed. Restore when persistence lands.
    <Button
      type="button"
      variant="outline"
      aria-disabled={disabled ? "true" : undefined}
      aria-label={
        hasNote ? m.home_detail_feedback_note_edit_label() : m.home_detail_feedback_note_add_label()
      }
      className={cn(
        "h-[34px] rounded-full px-3 text-xs text-muted-foreground shadow-none backdrop-blur-sm",
        // Use muted style regardless of hasNote — primary accent on a disabled button
        // looks interactive but never responds. When note persistence lands, restore:
        //   hasNote → active accent colors + hover:bg-muted/40 hover:text-foreground
        //   !hasNote → same muted base + hover:bg-muted/40 hover:text-foreground
        "border-border bg-foreground/6 text-muted-foreground",
        // pointer-events-none prevents hover styles from showing on a permanently unavailable
        // button. Add cursor-not-allowed alongside an onClick guard when note persistence lands.
        disabled && "opacity-50 pointer-events-none",
      )}
    >
      <MessageSquare className="size-3.5" aria-hidden="true" />
      {hasNote ? m.home_detail_feedback_note_added() : m.home_detail_feedback_note()}
    </Button>
  );
}
