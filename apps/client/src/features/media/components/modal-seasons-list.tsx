import { useMemo } from "react";
import {
  RequestableSeasonsList,
  type RequestableSeason,
  type SeasonOverrideStatus,
} from "@/features/requests";
import { mockData } from "../lib/mock-data";
import { useDetailStore } from "../lib/use-detail-store";
import type { DetailSeason, MediaDetailItem } from "../lib/types";

interface ModalSeasonsListProps {
  item: MediaDetailItem;
}

export function ModalSeasonsList({ item }: ModalSeasonsListProps) {
  const { role, pluginConfigured, defaultDestination, seasonRequests } = useDetailStore();
  const detailSeasons = useMemo(() => mockData.generateSeasons(item), [item]);
  const seasons = useMemo(() => detailSeasons.map(toRequestableSeason), [detailSeasons]);

  if (item.kind !== "tv" || seasons.length === 0) return null;

  return (
    <RequestableSeasonsList
      item={{ id: item.id, kind: item.kind, title: item.title }}
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
