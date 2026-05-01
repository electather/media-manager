import { MessageSquareIcon, SparklesIcon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import { m } from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";
import { useDetailStore } from "../lib/use-detail-store";

interface FeedbackBarProps {
  itemId: string;
  onJumpToNote: () => void;
  hasNote: boolean;
}

export function FeedbackBar({ itemId, onJumpToNote, hasNote }: FeedbackBarProps) {
  const { votes, setVote } = useDetailStore();
  const vote = votes[itemId] ?? null;

  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-2">
      <div className="mr-1 text-[11px] tracking-[0.06em] text-muted-foreground uppercase">
        {m.media_details_rating_label()}
      </div>
      <VoteButton
        active={vote === "up"}
        tone="up"
        onClick={() => setVote(itemId, vote === "up" ? null : "up")}
        label={m.media_details_vote_like()}
        icon={<ThumbsUpIcon className="size-3.5" />}
      />
      <VoteButton
        active={vote === "down"}
        tone="down"
        onClick={() => setVote(itemId, vote === "down" ? null : "down")}
        label={m.media_details_vote_dislike()}
        icon={<ThumbsDownIcon className="size-3.5" />}
      />
      <button
        onClick={onJumpToNote}
        aria-label={hasNote ? m.media_details_note_aria_edit() : m.media_details_note_aria_add()}
        title={hasNote ? m.media_details_note_aria_edit() : m.media_details_note_aria_add()}
        className={cn(
          "inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium backdrop-blur-md transition-all duration-150",
          hasNote
            ? "bg-primary/15 border-primary text-primary"
            : "bg-foreground/5 border-border text-muted-foreground",
        )}
      >
        <MessageSquareIcon className="size-3.5" />
        <span>{hasNote ? m.media_details_note_added() : m.media_details_note_add()}</span>
      </button>
      <span className="inline-flex items-center gap-1 font-mono text-[11px] tracking-[0.02em] text-muted-foreground/70">
        <SparklesIcon className="size-2.5" />
        <span>{m.media_details_tunes_recs()}</span>
      </span>
    </div>
  );
}

interface VoteButtonProps {
  active: boolean;
  tone: "up" | "down";
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}

function VoteButton({ active, tone, onClick, label, icon }: VoteButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        "inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs font-medium backdrop-blur-md transition-all duration-150",
        !active && "bg-foreground/5 border-border text-muted-foreground",
        active && tone === "up" && "bg-success/20 border-success/55 text-success",
        active && tone === "down" && "bg-destructive/20 border-destructive/55 text-destructive",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
