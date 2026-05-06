import * as m from "@/paraglide/messages";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/ui/tooltip";
import { cn } from "@/shared/lib/utils";
import type { RequestDestination, RequestStatus } from "../lib/types";
import { destinationTooltipText } from "./destination-helpers";

type Props = {
  status: Extract<RequestStatus, "pending" | "in-progress">;
  destination: RequestDestination;
  className?: string;
};

const STATUS_STYLE: Record<Props["status"], string> = {
  pending: "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300",
  "in-progress": "border-sky-500/40 bg-sky-500/10 text-sky-300",
};

export function RequestStatusInline({ status, destination, className }: Props) {
  const label =
    status === "pending" ? m.request_status_pending_label() : m.request_status_in_progress();

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={cn(
                "inline-flex items-center gap-2.5 rounded-md border px-3.5 py-2",
                STATUS_STYLE[status],
                className,
              )}
            >
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 animate-pulse rounded-full bg-current shadow-[0_0_8px_currentColor]"
              />
              <span className="text-sm font-medium text-foreground">{label}</span>
            </span>
          }
        />
        <TooltipContent>{destinationTooltipText(destination)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
