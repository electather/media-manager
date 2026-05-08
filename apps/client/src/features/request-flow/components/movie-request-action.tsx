import { useEffect, useState } from "react";
import { Plug, Plus } from "lucide-react";
import { toast } from "sonner";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/ui/tooltip";
import { useCreateRequest } from "../api/use-create-request";
import { normalizeRequestStatus } from "../lib/request-helpers";
import type { RequestDestination, RequestStatus } from "../lib/types";
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

export function MovieRequestAction({
  itemId,
  itemTitle,
  initialStatus,
  pluginConfigured = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<RequestStatus>(() => normalizeRequestStatus(initialStatus));
  const [destination, setDestination] = useState<RequestDestination>({
    serviceLabel: "—",
    profileLabel: null,
  });
  const create = useCreateRequest();

  // The hero on the full detail page is reused across navigations; reset
  // local request state whenever the underlying item changes so a
  // previously-submitted movie can't leak its pending status onto another.
  useEffect(() => {
    setStatus(normalizeRequestStatus(initialStatus));
    setOpen(false);
  }, [itemId, initialStatus]);

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

  async function handleSubmit(submission: PickerSubmission) {
    try {
      await create.mutateAsync({
        tmdbId: tmdbIdFromItemId(itemId),
        mediaType: "movie",
        serviceId: submission.serviceId,
        profileId: submission.profileId,
      });
      setDestination({
        serviceLabel: submission.serviceLabel,
        profileLabel: submission.profileLabel,
      });
      setStatus("pending");
      setOpen(false);
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

/**
 * The shared `HomeMediaItem.id` is `"movie:550"` / `"tv:1399"`. Strip the
 * prefix so the request body's `tmdbId` is just the numeric id.
 */
function tmdbIdFromItemId(itemId: string): string {
  const idx = itemId.indexOf(":");
  return idx === -1 ? itemId : itemId.slice(idx + 1);
}
