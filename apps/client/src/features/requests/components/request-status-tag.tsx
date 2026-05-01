import { m } from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";
import type { DisplaySeasonStatus } from "../lib/types";

interface RequestStatusTagProps {
  status: DisplaySeasonStatus;
  animated?: boolean;
  size?: "sm" | "md";
}

const TONE: Record<DisplaySeasonStatus, string> = {
  available: "text-success bg-success/15 border-success/40",
  "in-progress": "text-info bg-info/15 border-info/40",
  pending: "text-pending bg-pending/15 border-pending/40",
  unavailable: "text-muted-foreground bg-muted border-border",
  partial: "text-primary bg-primary/15 border-primary/40",
  upcoming: "text-muted-foreground bg-muted border-border",
};

const LABEL: Record<DisplaySeasonStatus, () => string> = {
  available: () => m.requests_status_available(),
  "in-progress": () => m.requests_status_in_progress(),
  pending: () => m.requests_status_pending(),
  unavailable: () => m.requests_status_unavailable(),
  partial: () => m.requests_status_partial(),
  upcoming: () => m.requests_status_upcoming(),
};

export function RequestStatusTag({ status, animated = false, size = "sm" }: RequestStatusTagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border font-mono leading-tight tracking-[0.04em] uppercase whitespace-nowrap",
        size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-[11px]",
        TONE[status],
      )}
    >
      <span
        className={cn("size-[5px] shrink-0 rounded-full bg-current", animated && "animate-pulse")}
      />
      {LABEL[status]()}
    </span>
  );
}
