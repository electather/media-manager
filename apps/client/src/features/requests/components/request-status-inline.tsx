import { ClockIcon, LoaderIcon } from "lucide-react";
import type { DestinationDescriptor, RequestRole, RequestStatus } from "../lib/types";

interface RequestStatusInlineProps {
  state: RequestStatus;
  role: RequestRole;
  destination: DestinationDescriptor;
}

export function RequestStatusInline({ state, destination }: RequestStatusInlineProps) {
  const isProcessing = state === "in-progress";
  const Icon = isProcessing ? LoaderIcon : ClockIcon;
  const label = isProcessing ? "Processing" : "Pending";

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
      <Icon className={`size-3.5 ${isProcessing ? "animate-spin" : ""}`} />
      <span>
        {label}
        <span className="ml-1.5 opacity-70">on {destination.serviceLabel}</span>
      </span>
    </div>
  );
}
