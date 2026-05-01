import { PlayIcon } from "lucide-react";
import { Button } from "@/shared/ui/button";
import type { StreamLink } from "../lib/types";

interface WatchActionsProps {
  link: StreamLink;
  progress?: { watched: number; total: number };
  onPlay: () => void;
}

export function WatchActions({ link, progress, onPlay }: WatchActionsProps) {
  const partial = progress && progress.watched > 0 && progress.watched < progress.total;
  const finished = progress && progress.total > 0 && progress.watched >= progress.total;
  const label = partial ? "Continue" : finished ? "Watch again" : "Watch";

  return (
    <Button onClick={onPlay} className="gap-2">
      <PlayIcon className="size-4" />
      <span>
        {label}
        <span className="ml-1.5 text-xs opacity-70">on {link.source}</span>
      </span>
    </Button>
  );
}
