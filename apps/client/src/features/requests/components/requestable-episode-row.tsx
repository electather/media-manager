import { m } from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { RequestStatusTag } from "./request-status-tag";
import type { DestinationDescriptor, DisplaySeasonStatus, RequestableEpisode } from "../lib/types";

interface RequestableEpisodeRowProps {
  ep: RequestableEpisode;
  status: DisplaySeasonStatus;
  destination: DestinationDescriptor;
}

export function RequestableEpisodeRow({ ep, status, destination }: RequestableEpisodeRowProps) {
  const dim = status === "unavailable" || status === "upcoming";
  const animated = status === "in-progress" || status === "pending";

  const badge = <RequestStatusTag status={status} animated={animated} />;

  return (
    <div
      className={cn(
        "grid grid-cols-[32px_1fr_auto] items-center gap-3.5 border-t border-border px-3.5 py-2.5",
        dim && "opacity-65",
      )}
    >
      <div className="font-mono text-xs text-muted-foreground tabular-nums">
        {String(ep.episode).padStart(2, "0")}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-foreground">{ep.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>{ep.airDate}</span>
          {status !== "upcoming" && (
            <>
              <span>·</span>
              <span>{ep.runtime} min</span>
            </>
          )}
        </div>
      </div>
      {animated ? (
        <Tooltip>
          <TooltipTrigger render={<span>{badge}</span>} />
          <TooltipContent side="top">
            {m.requests_tooltip_destination({
              service: destination.serviceLabel,
              profile: destination.profileLabel,
            })}
          </TooltipContent>
        </Tooltip>
      ) : (
        badge
      )}
    </div>
  );
}
