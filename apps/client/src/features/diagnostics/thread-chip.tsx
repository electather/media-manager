import { ArrowUpRightIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { shortRequestId } from "@/shared/lib/diagnostics/request-id";

interface Props {
  requestId: string | null | undefined;
  onJump?: (requestId: string) => void;
  className?: string;
}

/** Clickable request_id pill that ties errors ↔ performance via the page-level
 *  jump handler. Visually accents with the project's primary tone — used so a
 *  reader can spot at a glance which records share a request thread. */
export function ThreadChip({ requestId, onJump, className }: Props) {
  if (!requestId) return null;
  const interactive = typeof onJump === "function";
  const Tag = interactive ? "button" : "span";
  return (
    <Tag
      type={interactive ? "button" : undefined}
      onClick={
        interactive
          ? (event) => {
              event.stopPropagation();
              onJump?.(requestId);
            }
          : undefined
      }
      title={interactive ? `Trace request ${requestId} across tabs` : requestId}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-[2px] font-mono text-[11px] font-medium whitespace-nowrap transition-colors",
        interactive
          ? "cursor-pointer border-primary/40 bg-primary/10 text-primary hover:border-primary/60 hover:bg-primary/20"
          : "border-dashed border-border text-muted-foreground",
        className,
      )}
    >
      <span>{shortRequestId(requestId)}</span>
      {interactive ? <ArrowUpRightIcon className="size-3 opacity-80" /> : null}
    </Tag>
  );
}
