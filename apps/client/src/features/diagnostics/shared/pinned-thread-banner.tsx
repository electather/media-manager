import { FilterIcon } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { ThreadChip } from "../thread-chip";

interface Props {
  label: string;
  requestId: string;
  matches?: number;
  onClearRequestId: () => void;
}

export function PinnedThreadBanner({ label, requestId, matches, onClearRequestId }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm text-foreground/85">
      <FilterIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span>{label}</span>
      <ThreadChip requestId={requestId} />
      {matches !== undefined ? (
        <span className="text-muted-foreground">
          — {matches} {matches === 1 ? "match" : "matches"}.
        </span>
      ) : null}
      <Button variant="outline" size="sm" onClick={onClearRequestId} className="ml-auto">
        Clear thread
      </Button>
    </div>
  );
}
