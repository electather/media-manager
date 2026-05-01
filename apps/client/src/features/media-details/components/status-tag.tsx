import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";
import type { EpisodeStatus } from "../lib/types";

interface StatusTagProps {
  status: EpisodeStatus;
  size?: "sm" | "md";
}

const TONE: Record<EpisodeStatus, string> = {
  available: "text-success bg-success/15 border-success/40",
  requested: "text-info bg-info/15 border-info/40",
  unavailable: "text-muted-foreground bg-muted border-border",
  partial: "text-primary bg-primary/15 border-primary/40",
  upcoming: "text-muted-foreground bg-muted border-border",
};

const LABEL: Record<EpisodeStatus, () => string> = {
  available: () => m.media_details_status_available(),
  requested: () => m.media_details_status_requested(),
  unavailable: () => m.media_details_status_unavailable(),
  partial: () => m.media_details_status_partial(),
  upcoming: () => m.media_details_status_upcoming(),
};

export function StatusTag({ status, size = "sm" }: StatusTagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded font-mono tracking-[0.04em] uppercase whitespace-nowrap leading-tight border",
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]",
        TONE[status],
      )}
    >
      <span className="size-[5px] shrink-0 rounded-full bg-current" />
      {LABEL[status]()}
    </span>
  );
}
