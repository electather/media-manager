import { useState } from "react";
import { Plug, Plus } from "lucide-react";
import { toast } from "sonner";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/ui/tooltip";
import { DEFAULT_MOVIE_PROFILE_ID, DEFAULT_MOVIE_SERVICE_ID, ROLES } from "../lib/mock-services";
import { describeDestination, normalizeRequestStatus } from "../lib/request-helpers";
import type { RequestPayload, RequestStatus, UserRole } from "../lib/types";
import { RequestPicker } from "./request-picker";
import { RequestStatusInline } from "./request-status-inline";

type Props = {
  itemId: string;
  itemTitle: string;
  /**
   * Existing wire status. If `available`, the action renders nothing — the
   * caller (modal action bar) is expected to surface the watch button.
   */
  initialStatus?: string;
  role?: UserRole;
  defaultServiceId?: string;
  defaultProfileId?: string;
  pluginConfigured?: boolean;
  /** Mock callback. Logs to the console and surfaces a toast by default. */
  onSubmit?: (payload: RequestPayload) => void;
};

export function MovieRequestAction({
  itemId,
  itemTitle,
  initialStatus,
  role = "user",
  defaultServiceId = DEFAULT_MOVIE_SERVICE_ID,
  defaultProfileId = DEFAULT_MOVIE_PROFILE_ID,
  pluginConfigured = true,
  onSubmit,
}: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<RequestStatus>(() => normalizeRequestStatus(initialStatus));

  const destination = describeDestination("movie", defaultServiceId, defaultProfileId);

  if (!pluginConfigured) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button size="lg" variant="outline" disabled className="border-dashed opacity-60">
                <Plug aria-hidden="true" className="size-4" />
                {m.request_action_no_plugin()}
              </Button>
            }
          />
          <TooltipContent>{m.request_action_no_plugin_tooltip()}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (status === "pending" || status === "in-progress") {
    return <RequestStatusInline status={status} destination={destination} />;
  }

  function handleSubmit(payload: RequestPayload) {
    const next: RequestStatus = ROLES[role].needsApproval ? "pending" : "in-progress";
    setStatus(next);
    setOpen(false);
    onSubmit?.(payload);

    if (next === "pending") {
      toast.info(m.request_toast_submitted_movie_pending({ title: itemTitle }));
    } else {
      toast.success(m.request_toast_submitted_movie({ title: itemTitle }));
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button size="lg">
            <Plus aria-hidden="true" className="size-4" />
            {m.request_action_button()}
          </Button>
        }
      />
      <PopoverContent align="start" className="w-auto p-0">
        <RequestPicker
          itemId={itemId}
          itemTitle={itemTitle}
          kind="movie"
          defaultServiceId={defaultServiceId}
          defaultProfileId={defaultProfileId}
          onSubmit={handleSubmit}
          onCancel={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
