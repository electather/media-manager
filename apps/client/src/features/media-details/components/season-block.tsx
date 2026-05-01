import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { m } from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";
import { EpisodeRow } from "./episode-row";
import { StatusTag } from "./status-tag";
import type { DetailSeason } from "../lib/types";

interface SeasonBlockProps {
  season: DetailSeason;
  defaultOpen?: boolean;
}

export function SeasonBlock({ season, defaultOpen = false }: SeasonBlockProps) {
  const [open, setOpen] = useState(defaultOpen);
  const counts = season.counts ?? {};
  const total = season.episodeCount;

  let subline: string;
  if (season.status === "upcoming") {
    subline = m.media_details_episodes_upcoming({ count: total });
  } else if (season.status === "partial") {
    subline = m.media_details_episodes_partial({ available: counts.available ?? 0, total });
  } else {
    subline = m.media_details_episodes_total({ total });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-3.5 py-3 text-left text-foreground"
      >
        <span
          className={cn(
            "inline-flex shrink-0 text-muted-foreground transition-transform duration-200",
            open ? "rotate-0" : "-rotate-90",
          )}
        >
          <ChevronDownIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{season.title}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{subline}</div>
        </div>
        <StatusTag status={season.status} />
      </button>
      {open && (
        <div className="bg-card">
          {season.episodes.map((ep) => (
            <EpisodeRow key={ep.id} ep={ep} />
          ))}
        </div>
      )}
    </div>
  );
}
