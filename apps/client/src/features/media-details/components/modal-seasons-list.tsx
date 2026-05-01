import { RequestableSeasonsList } from "@/features/requests";
import { useDetailStore } from "../lib/use-detail-store";
import type { MediaDetailItem } from "../lib/types";

interface ModalSeasonsListProps {
  item: MediaDetailItem;
}

// Wraps RequestableSeasonsList — feeds it live overrides from the store so
// per-season requests survive close/reopen of the modal.
export function ModalSeasonsList({ item }: ModalSeasonsListProps) {
  const { role, pluginConfigured, defaultDestination, seasonRequests } = useDetailStore();
  if (item.kind !== "tv") return null;

  return (
    <RequestableSeasonsList
      item={{ id: item.id, kind: item.kind, title: item.title }}
      role={role}
      defaultServiceId={defaultDestination.serviceId}
      defaultProfileId={defaultDestination.profileId}
      pluginConfigured={pluginConfigured}
      initialOverrides={seasonRequests[item.id] ?? {}}
    />
  );
}
