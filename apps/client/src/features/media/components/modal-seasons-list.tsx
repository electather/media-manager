import { useMemo } from "react";
import {
  RequestableSeasonsList,
  type RequestableSeason,
  type SeasonOverrideStatus,
} from "@/features/requests";
import { useDetailStore } from "../lib/use-detail-store";
import type { DetailSeason, MediaDetail } from "../lib/types";

interface ModalSeasonsListProps {
  item: MediaDetail;
  isHydrating?: boolean;
}

export function ModalSeasonsList({ item, isHydrating = false }: ModalSeasonsListProps) {
  const { role, pluginConfigured, defaultDestination, seasonRequests } = useDetailStore();
  const seasons = useMemo(() => (item.seasons ?? []).map(toRequestableSeason), [item.seasons]);

  if (item.mediaType !== "tv") return null;
  if (!item.seasons) {
    return isHydrating ? <div className="mb-4 h-24 animate-pulse rounded-md bg-muted" /> : null;
  }
  if (seasons.length === 0) return null;

  return (
    <RequestableSeasonsList
      item={{ id: item.id, kind: item.mediaType, title: item.title }}
      seasons={seasons}
      role={role}
      defaultServiceId={defaultDestination.serviceId}
      defaultProfileId={defaultDestination.profileId}
      pluginConfigured={pluginConfigured}
      initialOverrides={(seasonRequests[item.id] ?? {}) as Record<number, SeasonOverrideStatus>}
    />
  );
}

function toRequestableSeason(detail: DetailSeason, index: number): RequestableSeason {
  return {
    id: detail.id,
    season: index + 1,
    title: detail.title,
    episodeCount: detail.episodeCount,
    status: detail.status,
    episodes: detail.episodes.map((ep) => ({
      id: ep.id,
      episode: ep.episode,
      title: ep.title,
      airDate: ep.airDate,
      runtime: ep.runtime,
      status: ep.status,
    })),
    counts: detail.counts,
  };
}
