import { PlusIcon } from "lucide-react";
import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { RequestStatusTag } from "./request-status-tag";
import type { DestinationDescriptor, DisplaySeasonStatus, RequestableSeason } from "../lib/types";

interface SeasonActionProps {
  season: RequestableSeason;
  status: DisplaySeasonStatus;
  destination: DestinationDescriptor;
  onRequest: (season: RequestableSeason) => void;
  onUndo: (season: RequestableSeason) => void;
}

export function SeasonAction({
  season,
  status,
  destination,
  onRequest,
  onUndo,
}: SeasonActionProps) {
  const tip = m.requests_tooltip_destination({
    service: destination.serviceLabel,
    profile: destination.profileLabel,
  });

  if (status === "available" || status === "upcoming") {
    return <RequestStatusTag status={status} />;
  }

  if (status === "in-progress") {
    return (
      <Tooltip>
        <TooltipTrigger render={<RequestStatusTag status="in-progress" animated />} />
        <TooltipContent side="top">{tip}</TooltipContent>
      </Tooltip>
    );
  }

  if (status === "pending") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span className="inline-flex items-center gap-1.5">
              <RequestStatusTag status="pending" animated />
              <Button
                variant="ghost"
                size="xs"
                title={m.requests_action_cancel_title()}
                onClick={(event) => {
                  event.stopPropagation();
                  onUndo(season);
                }}
              >
                {m.requests_action_cancel()}
              </Button>
            </span>
          }
        />
        <TooltipContent side="top">{m.requests_tooltip_pending()}</TooltipContent>
      </Tooltip>
    );
  }

  const label =
    status === "partial" ? m.requests_action_request_missing() : m.requests_action_request();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="xs"
            className="font-mono tracking-[0.04em] uppercase"
            onClick={(event) => {
              event.stopPropagation();
              onRequest(season);
            }}
          >
            <PlusIcon />
            {label}
          </Button>
        }
      />
      <TooltipContent side="top">{tip}</TooltipContent>
    </Tooltip>
  );
}
