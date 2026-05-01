import { CheckIcon, EyeIcon, FilmIcon, MoreHorizontalIcon, PlusIcon, XIcon } from "lucide-react";
import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import {
  RequestActions,
  RequestStatusInline,
  SERVICES,
  WatchActions,
  describeDestination,
  effectiveItemRequestStatus,
} from "@/features/requests";
import { useDetailStore } from "../lib/use-detail-store";
import type { MediaDetailItem } from "../lib/types";

interface ModalActionRowProps {
  item: MediaDetailItem;
  inWl: boolean;
  isWatched: boolean;
  toggleWatched: (id: string) => void;
  toggleWatchlist: (id: string) => void;
  openTrailer: (id: string) => void;
}

export function ModalActionRow({
  item,
  inWl,
  isWatched,
  toggleWatched,
  toggleWatchlist,
  openTrailer,
}: ModalActionRowProps) {
  const { role, pluginConfigured, defaultDestination, requests, submitRequest, cancelRequest, showToast } =
    useDetailStore();

  const reqStatus = effectiveItemRequestStatus(
    { id: item.id, kind: item.kind, title: item.title },
    requests,
  );
  const dest = describeDestination(defaultDestination.serviceId, defaultDestination.profileId, SERVICES);

  const showWatch = item.kind === "movie" && reqStatus === "available";
  const showInlineStatus =
    item.kind === "movie" && (reqStatus === "pending" || reqStatus === "in-progress");
  const showRequest = item.kind === "movie" && reqStatus === "unavailable";

  const onPlay = () => showToast(m.media_details_opening_stream());

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {showWatch && (
        <WatchActions
          link={item.streamLink ?? { source: dest.serviceLabel }}
          progress={item.progress}
          onPlay={onPlay}
        />
      )}
      {showInlineStatus && <RequestStatusInline state={reqStatus} role={role} destination={dest} />}
      {showRequest && (
        <RequestActions
          item={{ id: item.id, kind: item.kind, title: item.title }}
          role={role}
          defaultServiceId={defaultDestination.serviceId}
          defaultProfileId={defaultDestination.profileId}
          pluginConfigured={pluginConfigured}
          onSubmit={() => submitRequest(item.id, defaultDestination)}
        />
      )}
      {showInlineStatus && (
        <Button variant="ghost" onClick={() => cancelRequest(item.id)} className="gap-1.5">
          <XIcon className="size-3.5" /> {m.media_details_cancel_request()}
        </Button>
      )}

      <Button variant="ghost" onClick={() => openTrailer(item.id)} className="gap-1.5">
        <FilmIcon className="size-3.5" />
        {m.media_details_action_trailer()}
      </Button>
      <Button variant="ghost" onClick={() => toggleWatchlist(item.id)} className="gap-1.5">
        {inWl ? <CheckIcon className="size-3.5" /> : <PlusIcon className="size-3.5" />}
        {inWl ? m.media_details_action_watchlist_on() : m.media_details_action_watchlist()}
      </Button>
      <Button variant="ghost" onClick={() => toggleWatched(item.id)} className="gap-1.5">
        {isWatched ? <CheckIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
        {isWatched ? m.media_details_action_watched_on() : m.media_details_action_watched()}
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={m.media_details_more_options()}>
        <MoreHorizontalIcon className="size-3.5" />
      </Button>
    </div>
  );
}
