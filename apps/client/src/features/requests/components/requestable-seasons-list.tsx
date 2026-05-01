import { PlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { describeDestination } from "../lib/helpers";
import { SERVICES } from "../lib/services";
import type {
  DisplaySeasonStatus,
  RequestRole,
  RequestableItem,
  RequestableSeason,
  SeasonOverrideStatus,
} from "../lib/types";
import { RequestableSeasonBlock } from "./requestable-season-block";

interface RequestableSeasonsListProps {
  item: RequestableItem;
  seasons: RequestableSeason[];
  role: RequestRole;
  defaultServiceId: string;
  defaultProfileId: string;
  pluginConfigured: boolean;
  initialOverrides?: Record<number, SeasonOverrideStatus>;
}

const REQUESTABLE: ReadonlyArray<DisplaySeasonStatus> = ["unavailable", "partial"];

export function RequestableSeasonsList({
  item,
  seasons,
  role,
  defaultServiceId,
  defaultProfileId,
  pluginConfigured,
  initialOverrides = {},
}: RequestableSeasonsListProps) {
  const [overrides, setOverrides] =
    useState<Record<number, SeasonOverrideStatus>>(initialOverrides);
  const destination = describeDestination(defaultServiceId, defaultProfileId, SERVICES);
  const nextStatus: SeasonOverrideStatus = role === "admin" ? "in-progress" : "pending";

  const displayBySeason = useMemo(
    () => new Map(seasons.map((s) => [s.season, resolveDisplayStatus(s, overrides[s.season])])),
    [seasons, overrides],
  );

  if (item.kind !== "tv" || seasons.length === 0) return null;

  const requestable = seasons.filter((s) => REQUESTABLE.includes(displayBySeason.get(s.season)!));
  const requestableCount = requestable.length;

  const requestSeason = (season: RequestableSeason) =>
    setOverrides((prev) => ({ ...prev, [season.season]: nextStatus }));

  const undoSeason = (season: RequestableSeason) =>
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[season.season];
      return next;
    });

  const requestAll = () =>
    setOverrides((prev) => {
      const next = { ...prev };
      for (const season of requestable) next[season.season] = nextStatus;
      return next;
    });

  return (
    <div className="mb-4">
      <div className="mb-2.5 flex items-baseline justify-between gap-2.5">
        <h3 className="text-[13px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
          {m.requests_seasons_title()}
        </h3>
        <div className="flex items-center gap-2.5">
          <div className="font-mono text-[11px] text-muted-foreground/70">
            {m.requests_seasons_count({ count: seasons.length })}
          </div>
          {pluginConfigured && requestableCount > 1 && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="xs"
                    className="font-mono tracking-[0.04em] uppercase"
                    onClick={requestAll}
                  >
                    <PlusIcon />
                    {m.requests_action_request_all()}
                  </Button>
                }
              />
              <TooltipContent side="top">
                {m.requests_tooltip_request_seasons({
                  count: requestableCount,
                  service: destination.serviceLabel,
                })}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {seasons.map((season, index) => (
          <RequestableSeasonBlock
            key={season.id}
            season={season}
            displayStatus={displayBySeason.get(season.season)!}
            destination={destination}
            pluginConfigured={pluginConfigured}
            defaultOpen={index === seasons.length - 1}
            onRequest={requestSeason}
            onUndo={undoSeason}
          />
        ))}
      </div>
    </div>
  );
}

function resolveDisplayStatus(
  season: RequestableSeason,
  override: SeasonOverrideStatus | undefined,
): DisplaySeasonStatus {
  if (override) return override;
  if (season.status === "requested") return "in-progress";
  return season.status;
}
