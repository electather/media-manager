import { Check, CircleAlert, Clock, HelpCircle } from "lucide-react";
import type { ComponentType } from "react";
import { m } from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";

type MediaStatus = "available" | "requested" | "processing" | "unavailable" | "unknown";

type StatusConfig = {
  label: () => string;
  Icon: ComponentType<{ className?: string }> | null;
  toneClass: string;
};

const STATUS_CONFIG: Record<MediaStatus, StatusConfig> = {
  available: {
    label: () => m.media_card_status_available(),
    Icon: Check,
    toneClass: "text-success border-success/50",
  },
  requested: {
    label: () => m.media_card_status_requested(),
    Icon: Clock,
    toneClass: "text-foreground border-transparent",
  },
  processing: {
    label: () => m.media_card_status_processing(),
    Icon: Clock,
    toneClass: "text-info border-info/50",
  },
  unavailable: {
    label: () => m.media_card_status_unavailable(),
    Icon: CircleAlert,
    toneClass: "text-warn border-warn/50",
  },
  unknown: {
    label: () => m.media_card_status_unknown(),
    Icon: HelpCircle,
    toneClass: "text-muted-foreground border-transparent",
  },
};

type MediaStatusPillProps = {
  status: MediaStatus;
  className?: string;
};

export function MediaStatusPill({ status, className }: MediaStatusPillProps) {
  const config = STATUS_CONFIG[status];
  if (!config) return null;
  const { Icon } = config;
  return (
    <span
      className={cn(
        "absolute top-2.5 left-2.5 z-3 inline-flex items-center gap-1 rounded-full border bg-black/55 px-2 py-0.5 text-[11px] backdrop-blur",
        config.toneClass,
        className,
      )}
    >
      {Icon ? <Icon className="size-3" /> : null}
      {config.label()}
    </span>
  );
}
