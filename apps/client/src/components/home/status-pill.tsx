import { cn } from "@/lib/utils";
import type { CompactMediaItem } from "@ent-mcp/shared/home";

type Status = NonNullable<CompactMediaItem["status"]>;

const COPY: Record<Status, string> = {
  available: "Available",
  requested: "Requested",
  processing: "Processing",
  unavailable: "Unavailable",
  unknown: "Unknown",
};

const STYLES: Record<Status, string> = {
  available: "bg-emerald-500/85 text-white",
  requested: "bg-amber-500/85 text-white",
  processing: "bg-sky-500/85 text-white",
  unavailable: "bg-zinc-500/85 text-white",
  unknown: "bg-zinc-500/85 text-white",
};

export function StatusPill({ status, className }: { status: Status; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium leading-none shadow-sm backdrop-blur-sm",
        STYLES[status],
        className,
      )}
    >
      <span className="sr-only">Status: </span>
      {COPY[status]}
    </span>
  );
}
