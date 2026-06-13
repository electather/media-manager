import type { NotificationSeverity } from "@nama/shared/notifications";
import { cn } from "@/shared/lib/utils";
import { SEVERITY_META } from "./types";

interface Props {
  severity: NotificationSeverity;
}

export function SeverityIcon({ severity }: Props) {
  const { Icon: SevIcon, iconBg, iconColor } = SEVERITY_META[severity];
  return (
    <span
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full",
        iconBg,
        iconColor,
      )}
    >
      <SevIcon className="size-3.5" />
    </span>
  );
}
