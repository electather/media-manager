import { cn } from "@/shared/lib/utils";
import { StatusTag } from "./status-tag";
import type { DetailEpisode } from "../lib/types";

interface EpisodeRowProps {
  ep: DetailEpisode;
}

export function EpisodeRow({ ep }: EpisodeRowProps) {
  const dim = ep.status === "unavailable" || ep.status === "upcoming";
  return (
    <div
      className={cn(
        "grid grid-cols-[32px_1fr_auto] items-center gap-3.5 border-t border-border px-3.5 py-2.5",
        dim && "opacity-65",
      )}
    >
      <div className="font-mono text-xs text-muted-foreground tabular-nums">
        {String(ep.episode).padStart(2, "0")}
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-foreground">{ep.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span>{ep.airDate}</span>
          {ep.status !== "upcoming" && (
            <>
              <span>·</span>
              <span>{ep.runtime} min</span>
            </>
          )}
        </div>
      </div>
      <StatusTag status={ep.status} />
    </div>
  );
}
