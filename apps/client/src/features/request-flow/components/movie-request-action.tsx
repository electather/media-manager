import { useState } from "react";
import { Plug, Plus } from "lucide-react";
import { toast } from "sonner";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/ui/tooltip";
import { useCancelRequest } from "../hooks/use-cancel-request";
import { useCreateRequest } from "../hooks/use-create-request";
import { useUserRequests } from "../hooks/use-user-requests";
import {
  mediaRequestToUiStatus,
  normalizeRequestStatus,
  selectRequestForMedia,
  tmdbIdFromItemId,
} from "../lib/request-helpers";
import type { RequestDestination } from "../lib/types";
import { RequestPicker, type PickerSubmission } from "./request-picker";
import { RequestPickerBoundary } from "./request-picker-boundary";
import { RequestStatusInline } from "./request-status-inline";

type Props = {
  itemId: string;
  itemTitle: string;
  /**
   * Existing wire status. If `available`, the action renders nothing — the
   * caller (modal action bar) is expected to surface the watch button.
   */
  initialStatus?: string;
  pluginConfigured?: boolean;
};

const NEUTRAL_DESTINATION: RequestDestination = { serviceLabel: "—", profileLabel: null };

export function MovieRequestAction({
  itemId,
  itemTitle,
  initialStatus,
  pluginConfigured = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const create = useCreateRequest();
  const cancel = useCancelRequest();
  const { data } = useUserRequests();

  const tmdbId = tmdbIdFromItemId(itemId);
  const userRow = selectRequestForMedia(data?.items, tmdbId, "movie");
  const userStatus = userRow ? mediaRequestToUiStatus(userRow.status) : null;
  const status = userStatus ?? normalizeRequestStatus(initialStatus);
  const destination: RequestDestination = userRow
    ? { serviceLabel: userRow.targetLabel ?? "—", profileLabel: userRow.profileLabel }
    : NEUTRAL_DESTINATION;

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
    const optimistic = userRow?.id?.startsWith("__optimistic-") ?? false;
    return (
      <RequestStatusInline
        status={status}
        destination={destination}
        onCancel={userRow ? () => cancel.mutate({ requestId: userRow.id }) : undefined}
        cancelDisabled={cancel.isPending || optimistic}
      />
    );
  }

  async function handleSubmit(submission: PickerSubmission) {
    try {
      await create.mutateAsync({
        tmdbId,
        mediaType: "movie",
        serviceId: submission.serviceId,
        profileId: submission.profileId,
        serviceLabel: submission.serviceLabel,
        profileLabel: submission.profileLabel,
      });
      toast.success(m.request_toast_submitted_movie_pending({ title: itemTitle }));
    } catch {
      // `useCreateRequest` already surfaces the destructive toast.
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
        <RequestPickerBoundary mediaType="movie">
          <RequestPicker
            itemTitle={itemTitle}
            mediaType="movie"
            onSubmit={handleSubmit}
            onCancel={() => setOpen(false)}
            pending={create.isPending}
          />
        </RequestPickerBoundary>
      </PopoverContent>
    </Popover>
  );
}
