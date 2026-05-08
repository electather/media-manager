import { useState } from "react";
import { Plus } from "lucide-react";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/ui/tooltip";
import { getSeasonActionModel } from "../lib/request-helpers";
import type { RequestDestination, RequestStatus } from "../lib/types";
import { destinationTooltipText } from "./destination-helpers";
import { RequestPicker, type PickerSubmission } from "./request-picker";
import { RequestPickerBoundary } from "./request-picker-boundary";
import { RequestStatusBadge } from "./request-status-badge";

type Props = {
  itemTitle: string;
  seasonNumber: number;
  status: RequestStatus;
  destination: RequestDestination;
  pluginConfigured: boolean;
  pending?: boolean;
  onSubmit: (submission: PickerSubmission) => void | Promise<void>;
  onCancelPending: () => void;
};

export function SeasonRequestAction({
  itemTitle,
  seasonNumber,
  status,
  destination,
  pluginConfigured,
  pending = false,
  onSubmit,
  onCancelPending,
}: Props) {
  const [open, setOpen] = useState(false);
  const model = getSeasonActionModel(status, pluginConfigured);

  if (status === "available") return <RequestStatusBadge status="available" />;

  if (status === "in-progress") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <span className="inline-flex">
                <RequestStatusBadge status="in-progress" animated />
              </span>
            }
          />
          <TooltipContent>{destinationTooltipText(destination)}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (status === "pending") {
    return (
      <span className="inline-flex items-center gap-1.5">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex">
                  <RequestStatusBadge status="pending" animated />
                </span>
              }
            />
            <TooltipContent>{m.request_status_pending_label()}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={(event) => {
            event.stopPropagation();
            onCancelPending();
          }}
          aria-label={m.request_pending_cancel_tooltip()}
        >
          {m.request_pending_cancel()}
        </Button>
      </span>
    );
  }

  if (model.kind === "status") {
    // Upcoming or any non-requestable terminal state without plugin support.
    return <RequestStatusBadge status={model.status} />;
  }

  const label =
    model.label === "Request missing"
      ? m.request_season_request_missing()
      : m.request_season_request_season();

  async function handleSubmit(submission: PickerSubmission) {
    await onSubmit(submission);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="font-mono uppercase tracking-[0.04em]"
            onClick={(event) => event.stopPropagation()}
          >
            <Plus aria-hidden="true" className="size-3" />
            {label}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-auto p-0">
        <RequestPickerBoundary mediaType="tv">
          <RequestPicker
            itemTitle={itemTitle}
            mediaType="tv"
            seasonNumbers={[seasonNumber]}
            onSubmit={handleSubmit}
            onCancel={() => setOpen(false)}
            pending={pending}
          />
        </RequestPickerBoundary>
      </PopoverContent>
    </Popover>
  );
}
