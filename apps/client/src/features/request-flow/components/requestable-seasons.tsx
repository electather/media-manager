import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { toast } from "sonner";
import * as m from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/shared/ui/tooltip";
import type { Episode, EpisodeStatus, Season } from "../lib/types";
import { DEFAULT_TV_PROFILE_ID, DEFAULT_TV_SERVICE_ID, ROLES } from "../lib/mock-services";
import {
  describeDestination,
  getRequestableSeasonNumbers,
  inferSeasonStatus,
  normalizeRequestStatus,
} from "../lib/request-helpers";
import type { RequestPayload, RequestStatus, UserRole } from "../lib/types";
import { destinationTooltipText } from "./destination-helpers";
import { RequestPicker } from "./request-picker";
import { RequestStatusBadge } from "./request-status-badge";
import { SeasonRequestAction } from "./season-request-action";

type Props = {
  itemId: string;
  itemTitle: string;
  seasons: Season[];
  role?: UserRole;
  defaultServiceId?: string;
  defaultProfileId?: string;
  pluginConfigured?: boolean;
  initialOverrides?: Record<number, RequestStatus>;
  onSeasonSubmit?: (payload: RequestPayload, seasonNumber: number) => void;
  onBulkSubmit?: (payload: RequestPayload, seasonNumbers: number[]) => void;
};

export function RequestableSeasons({
  itemId,
  itemTitle,
  seasons,
  role = "user",
  defaultServiceId = DEFAULT_TV_SERVICE_ID,
  defaultProfileId = DEFAULT_TV_PROFILE_ID,
  pluginConfigured = true,
  initialOverrides,
  onSeasonSubmit,
  onBulkSubmit,
}: Props) {
  const [overrides, setOverrides] = useState<Record<number, RequestStatus>>(initialOverrides ?? {});
  const [bulkOpen, setBulkOpen] = useState(false);

  // Reset the local override map whenever the underlying TV title changes,
  // since the detail page reuses this component across navigations and
  // overrides are keyed only by season number.
  useEffect(() => {
    setOverrides(initialOverrides ?? {});
    setBulkOpen(false);
    // `initialOverrides` is intentionally excluded from the dep list — the
    // common case passes a fresh object literal each render and we only
    // want to reset on item navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  if (!seasons || seasons.length === 0) return null;

  const destination = describeDestination("tv", defaultServiceId, defaultProfileId);

  const resolvedSeasons = useMemo(
    () =>
      seasons.map((season) => {
        const inferred = inferSeasonStatus(season);
        const status: RequestStatus = overrides[season.number] ?? inferred;
        return { season, status };
      }),
    [seasons, overrides],
  );

  const requestableSeasonNumbers = getRequestableSeasonNumbers(
    resolvedSeasons.map((entry) => ({ number: entry.season.number, status: entry.status })),
    pluginConfigured,
  );

  function applyStatusToSeason(seasonNumber: number) {
    const next: RequestStatus = ROLES[role].needsApproval ? "pending" : "in-progress";
    setOverrides((prev) => ({ ...prev, [seasonNumber]: next }));
    return next;
  }

  function handleSeasonRequest(payload: RequestPayload, seasonNumber: number) {
    const next = applyStatusToSeason(seasonNumber);
    onSeasonSubmit?.(payload, seasonNumber);
    if (next === "pending") {
      toast.info(m.request_toast_submitted_season_pending({ n: String(seasonNumber) }));
    } else {
      toast.success(m.request_toast_submitted_season({ n: String(seasonNumber) }));
    }
  }

  function handleSeasonCancel(seasonNumber: number) {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[seasonNumber];
      return next;
    });
    toast(m.request_toast_cancelled());
  }

  function handleBulkRequest(payload: RequestPayload) {
    const next: RequestStatus = ROLES[role].needsApproval ? "pending" : "in-progress";
    setOverrides((prev) => {
      const updated = { ...prev };
      for (const num of requestableSeasonNumbers) updated[num] = next;
      return updated;
    });
    onBulkSubmit?.(payload, requestableSeasonNumbers);
    toast.success(
      m.request_toast_submitted_seasons({ n: String(requestableSeasonNumbers.length) }),
    );
    setBulkOpen(false);
  }

  return (
    <section
      aria-label={m.home_detail_seasons_label()}
      className="flex flex-col gap-2 px-0 sm:px-10"
    >
      {pluginConfigured && requestableSeasonNumbers.length > 1 ? (
        <div className="flex items-center justify-end pb-1">
          <Popover open={bulkOpen} onOpenChange={setBulkOpen}>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <PopoverTrigger
                      render={
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          className="font-mono uppercase tracking-[0.04em]"
                        >
                          <Plus aria-hidden="true" className="size-3" />
                          {m.request_seasons_request_all()}
                        </Button>
                      }
                    />
                  }
                />
                <TooltipContent>
                  {m.request_seasons_request_all_tooltip({
                    n: String(requestableSeasonNumbers.length),
                    service: destination.serviceLabel,
                  })}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <PopoverContent align="end" className="w-auto p-0">
              <RequestPicker
                itemId={itemId}
                itemTitle={itemTitle}
                kind="tv"
                seasonNumbers={requestableSeasonNumbers}
                defaultServiceId={defaultServiceId}
                defaultProfileId={defaultProfileId}
                onSubmit={handleBulkRequest}
                onCancel={() => setBulkOpen(false)}
              />
            </PopoverContent>
          </Popover>
        </div>
      ) : null}

      {resolvedSeasons.map(({ season, status }, index) => (
        <SeasonRow
          key={`${itemId}-s${season.number}`}
          itemId={itemId}
          itemTitle={itemTitle}
          season={season}
          status={status}
          destination={destination}
          defaultServiceId={defaultServiceId}
          defaultProfileId={defaultProfileId}
          pluginConfigured={pluginConfigured}
          defaultOpen={index === resolvedSeasons.length - 1}
          onRequest={(payload) => handleSeasonRequest(payload, season.number)}
          onCancelPending={() => handleSeasonCancel(season.number)}
        />
      ))}
    </section>
  );
}

type SeasonRowProps = {
  itemId: string;
  itemTitle: string;
  season: Season;
  status: RequestStatus;
  destination: ReturnType<typeof describeDestination>;
  defaultServiceId: string;
  defaultProfileId: string;
  pluginConfigured: boolean;
  defaultOpen: boolean;
  onRequest: (payload: RequestPayload) => void;
  onCancelPending: () => void;
};

function SeasonRow({
  itemId,
  itemTitle,
  season,
  status,
  destination,
  defaultServiceId,
  defaultProfileId,
  pluginConfigured,
  defaultOpen,
  onRequest,
  onCancelPending,
}: SeasonRowProps) {
  const subline = buildSubline(season, status);
  const hasEpisodes = season.episodes.length > 0;

  const action = pluginConfigured ? (
    <SeasonRequestAction
      itemId={itemId}
      itemTitle={itemTitle}
      seasonNumber={season.number}
      status={status}
      destination={destination}
      defaultServiceId={defaultServiceId}
      defaultProfileId={defaultProfileId}
      pluginConfigured={pluginConfigured}
      onSubmit={onRequest}
      onCancelPending={onCancelPending}
    />
  ) : (
    <RequestStatusBadge status={status} />
  );

  const titleBlock = (
    <div className="min-w-0 flex-1">
      <div className="text-sm font-medium text-foreground">
        {m.home_detail_season_number({ n: String(season.number) })}
      </div>
      <div className="text-xs text-muted-foreground">{subline}</div>
    </div>
  );

  if (!hasEpisodes) {
    // Seasons with no known episodes (typically just-announced) collapse to
    // a flat row — no chevron, no expandable empty drawer.
    return (
      <div className="flex items-center gap-3 overflow-hidden rounded-xl border border-border bg-card/80 px-3 py-3 sm:px-4">
        {titleBlock}
        <div className="shrink-0">{action}</div>
      </div>
    );
  }

  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className="overflow-hidden rounded-xl border border-border bg-card/80"
    >
      <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
        <CollapsibleTrigger className="group flex flex-1 items-center gap-3 text-start outline-none">
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180"
          />
          {titleBlock}
        </CollapsibleTrigger>
        <div className="shrink-0">{action}</div>
      </div>
      <CollapsibleContent className="border-t border-border/60 bg-background/30">
        <EpisodeList episodes={season.episodes} seasonStatus={status} destination={destination} />
      </CollapsibleContent>
    </Collapsible>
  );
}

// Single-status sublines just need the season's episode count. Keeping
// them in a lookup table flattens `buildSubline` into a small dispatch
// rather than a six-branch chain.
const COUNT_ONLY_SUBLINE: Partial<Record<RequestStatus, (total: number) => string>> = {
  upcoming: (total) => m.request_subline_upcoming({ n: String(total) }),
  missing: (total) => m.request_subline_missing({ n: String(total) }),
  "in-progress": (total) => m.request_subline_in_progress({ n: String(total) }),
  pending: (total) => m.request_subline_pending({ n: String(total) }),
};

function buildSubline(season: Season, status: RequestStatus): string {
  const total = season.episodeCount;
  if (total === 0) return m.request_subline_announced();
  const single = COUNT_ONLY_SUBLINE[status];
  if (single) return single(total);
  if (status === "partial") return buildPartialSubline(season, total);
  return m.home_detail_season_episode_count({ n: String(total) });
}

function buildPartialSubline(season: Season, total: number): string {
  const available = season.counts.available ?? 0;
  const requested = season.counts.requested ?? 0;
  const upcoming = season.counts.upcoming ?? 0;
  const parts: string[] = [
    m.request_subline_partial({ available: String(available), total: String(total) }),
  ];
  if (requested > 0) parts.push(m.request_subline_partial_in_progress({ n: String(requested) }));
  if (upcoming > 0) parts.push(m.request_subline_partial_upcoming({ n: String(upcoming) }));
  return parts.join(" · ");
}

function EpisodeList({
  episodes,
  seasonStatus,
  destination,
}: {
  episodes: Episode[];
  seasonStatus: RequestStatus;
  destination: ReturnType<typeof describeDestination>;
}) {
  return (
    <ul className="flex flex-col">
      {episodes.map((ep) => (
        <EpisodeRow key={ep.id} ep={ep} seasonStatus={seasonStatus} destination={destination} />
      ))}
    </ul>
  );
}

function EpisodeRow({
  ep,
  seasonStatus,
  destination,
}: {
  ep: Episode;
  seasonStatus: RequestStatus;
  destination: ReturnType<typeof describeDestination>;
}) {
  // Episodes that are still missing inherit the season-level override so an
  // in-progress season shows in-progress on every missing episode while
  // already-available episodes keep their badge.
  const episodeStatus = effectiveEpisodeStatus(ep.status, seasonStatus);
  const dim = episodeStatus === "missing" || episodeStatus === "upcoming";
  const animated = episodeStatus === "in-progress" || episodeStatus === "pending";

  const badge = <RequestStatusBadge status={episodeStatus} animated={animated} />;

  return (
    <li
      className={`grid grid-cols-[1.75rem_1fr_auto] items-center gap-2.5 border-b border-border/40 px-3 py-2.5 last:border-b-0 sm:grid-cols-[2rem_1fr_auto] sm:gap-3 sm:px-4 ${dim ? "opacity-60" : ""}`}
    >
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {String(ep.episode).padStart(2, "0")}
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-foreground">{ep.title}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="whitespace-nowrap">{ep.airDate}</span>
          {episodeStatus !== "upcoming" ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="whitespace-nowrap">{ep.runtime} min</span>
            </>
          ) : null}
        </div>
      </div>
      {animated ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex">{badge}</span>} />
            <TooltipContent>{destinationTooltipText(destination)}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        badge
      )}
    </li>
  );
}

function effectiveEpisodeStatus(
  episodeStatus: EpisodeStatus,
  seasonStatus: RequestStatus,
): RequestStatus {
  const normalizedEpisode = normalizeRequestStatus(episodeStatus);
  if (
    (seasonStatus === "in-progress" || seasonStatus === "pending") &&
    normalizedEpisode !== "available"
  ) {
    return seasonStatus;
  }
  return normalizedEpisode;
}
