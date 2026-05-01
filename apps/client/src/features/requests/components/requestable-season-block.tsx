import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { m } from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible";
import { RequestStatusTag } from "./request-status-tag";
import { RequestableEpisodeRow } from "./requestable-episode-row";
import { SeasonAction } from "./season-action";
import type {
  DestinationDescriptor,
  DisplaySeasonStatus,
  RequestableEpisode,
  RequestableSeason,
} from "../lib/types";

interface RequestableSeasonBlockProps {
  season: RequestableSeason;
  displayStatus: DisplaySeasonStatus;
  destination: DestinationDescriptor;
  pluginConfigured: boolean;
  defaultOpen: boolean;
  onRequest: (season: RequestableSeason) => void;
  onUndo: (season: RequestableSeason) => void;
}

export function RequestableSeasonBlock({
  season,
  displayStatus,
  destination,
  pluginConfigured,
  defaultOpen,
  onRequest,
  onUndo,
}: RequestableSeasonBlockProps) {
  const [open, setOpen] = useState(defaultOpen);
  const subline = formatSubline(season, displayStatus);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="overflow-visible rounded-lg border border-border bg-muted">
        <div className="flex w-full items-center gap-3 px-3 py-2.5">
          <CollapsibleTrigger
            aria-label={m.requests_toggle_aria({ title: season.title })}
            className="-m-1 flex flex-1 cursor-pointer items-center gap-3 rounded border-0 bg-transparent p-1 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <span
              className={cn(
                "inline-flex shrink-0 text-muted-foreground transition-transform duration-200",
                open ? "rotate-0" : "-rotate-90 rtl:rotate-90",
              )}
            >
              <ChevronDownIcon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">{season.title}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">{subline}</div>
            </div>
          </CollapsibleTrigger>
          <div className="relative z-10">
            {pluginConfigured ? (
              <SeasonAction
                season={season}
                status={displayStatus}
                destination={destination}
                onRequest={onRequest}
                onUndo={onUndo}
              />
            ) : (
              <RequestStatusTag status={displayStatus} />
            )}
          </div>
        </div>
        <CollapsibleContent className="border-t border-border bg-card">
          {season.episodes.map((ep) => (
            <RequestableEpisodeRow
              key={ep.id}
              ep={ep}
              status={resolveEpisodeStatus(ep, displayStatus)}
              destination={destination}
            />
          ))}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function formatSubline(season: RequestableSeason, status: DisplaySeasonStatus): string {
  const total = season.episodeCount;
  if (status === "upcoming") return m.requests_subline_upcoming({ count: total });
  if (status === "pending") return m.requests_subline_pending({ count: total });
  if (status === "in-progress") return m.requests_subline_in_progress({ count: total });
  if (status === "partial") {
    return m.requests_subline_partial({ available: season.counts?.available ?? 0, total });
  }
  return m.requests_subline_total({ count: total });
}

function resolveEpisodeStatus(
  ep: RequestableEpisode,
  seasonStatus: DisplaySeasonStatus,
): DisplaySeasonStatus {
  if (
    (seasonStatus === "pending" || seasonStatus === "in-progress") &&
    (ep.status === "unavailable" || ep.status === "requested")
  ) {
    return seasonStatus;
  }
  if (ep.status === "requested") return "in-progress";
  return ep.status;
}
