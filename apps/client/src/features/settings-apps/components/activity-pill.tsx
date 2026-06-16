import type { AuthorizedAppStatus } from "@nama/shared/users";

import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";

interface ActivityPillProps {
  status: AuthorizedAppStatus;
  className?: string;
}

const TONE: Record<
  AuthorizedAppStatus,
  { dot: string; bg: string; text: string; border: string; pulse: boolean }
> = {
  active: {
    dot: "bg-success",
    bg: "bg-success/10",
    text: "text-success",
    border: "border-success/30",
    pulse: true,
  },
  idle: {
    dot: "bg-muted-foreground/70",
    bg: "bg-muted",
    text: "text-muted-foreground",
    border: "border-border",
    pulse: false,
  },
  new: {
    dot: "bg-primary",
    bg: "bg-primary/10",
    text: "text-primary",
    border: "border-primary/30",
    pulse: false,
  },
};

export function ActivityPill({ status, className }: ActivityPillProps) {
  const tone = TONE[status];
  const label =
    status === "active"
      ? m.settings_apps_status_active()
      : status === "idle"
        ? m.settings_apps_status_idle()
        : m.settings_apps_status_new();

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium leading-tight tracking-wider",
        tone.bg,
        tone.text,
        tone.border,
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", tone.dot, tone.pulse && "animate-pulse")}
      />
      {label}
    </span>
  );
}
