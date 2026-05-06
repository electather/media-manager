import { cn } from "@/shared/lib/utils";
import * as m from "@/paraglide/messages";
import type { RequestStatus } from "../lib/types";

type Props = {
  status: RequestStatus;
  animated?: boolean;
  className?: string;
};

// Tailwind classes per status. Keep colours close to the prototype's intent
// (success / blue in-progress / purple pending / muted missing/upcoming /
// amber partial) while matching the rest of the UI's palette.
const STATUS_STYLE: Record<RequestStatus, string> = {
  available: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  "in-progress": "border-sky-500/40 bg-sky-500/15 text-sky-300",
  pending: "border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-300",
  missing: "border-border bg-muted/40 text-muted-foreground",
  partial: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  upcoming: "border-border bg-muted/40 text-muted-foreground",
};

const STATUS_LABEL: Record<RequestStatus, () => string> = {
  available: m.home_detail_season_available,
  "in-progress": m.request_status_in_progress,
  pending: m.request_status_pending,
  missing: m.request_status_missing,
  partial: m.request_status_partial,
  upcoming: m.request_status_upcoming,
};

export function RequestStatusBadge({ status, animated, className }: Props) {
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.04em]",
        STATUS_STYLE[status],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 shrink-0 rounded-full bg-current", animated && "animate-pulse")}
      />
      {STATUS_LABEL[status]()}
    </span>
  );
}
