import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";

import type { ConnectionStatus } from "../mocks";

const STATUS_LABEL: Record<ConnectionStatus, () => string> = {
  connected: () => m.settings_connections_status_connected(),
  expired: () => m.settings_connections_status_expired(),
  error: () => m.settings_connections_status_error(),
  disconnected: () => m.settings_connections_status_disconnected(),
};

const STATUS_CLASS: Record<ConnectionStatus, string> = {
  connected: "border-success/40 bg-success/10 text-success",
  expired: "border-amber-400/40 bg-amber-400/10 text-amber-500 dark:text-amber-400",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
  disconnected: "border-border bg-muted text-muted-foreground",
};

const STATUS_DOT: Record<ConnectionStatus, string> = {
  connected: "bg-success",
  expired: "bg-amber-500",
  error: "bg-destructive",
  disconnected: "bg-muted-foreground/60",
};

export function ConnectionStatusPill({ status }: { status: ConnectionStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide",
        STATUS_CLASS[status],
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
      {STATUS_LABEL[status]()}
    </span>
  );
}
