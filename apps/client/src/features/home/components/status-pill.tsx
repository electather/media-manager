import type { CompactMediaItem } from "@ent-mcp/shared/home";

import { cn } from "@/shared/lib/utils";

type Status = NonNullable<CompactMediaItem["status"]>;

const STATUS_LABEL: Record<Status, string> = {
  available: "Available",
  requested: "Requested",
  processing: "Processing",
  unavailable: "Unavailable",
  unknown: "Unknown",
};

const STATUS_CLASS: Record<Status, string> = {
  available: "bg-emerald-500/90 text-white",
  requested: "bg-amber-500/90 text-white",
  processing: "bg-sky-500/90 text-white",
  unavailable: "bg-red-500/90 text-white",
  unknown: "bg-slate-500/90 text-white",
};

interface StatusPillProps {
  status: CompactMediaItem["status"];
}

export function StatusPill({ status }: StatusPillProps) {
  if (!status) return null;
  return (
    <span
      role="status"
      className={cn(
        "absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase",
        STATUS_CLASS[status],
      )}
    >
      <span className="sr-only">Status: </span>
      {STATUS_LABEL[status]}
    </span>
  );
}
