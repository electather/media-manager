import type { NotificationCategory } from "@ent-mcp/shared/notifications";
import { Checkbox } from "@/shared/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { m } from "@/paraglide/messages";
import { useToggleSubscription } from "./use-toggle-subscription";

interface Props {
  connectionId: string;
  category: NotificationCategory;
  enabled: boolean;
  allowed: boolean;
  requiredPermission: string;
  forceOn?: boolean;
}

export function MatrixCell({
  connectionId,
  category,
  enabled,
  allowed,
  requiredPermission,
  forceOn,
}: Props) {
  const toggle = useToggleSubscription();
  const checkbox = (
    <Checkbox
      checked={forceOn ? true : enabled}
      disabled={!allowed || forceOn}
      onCheckedChange={(v) => toggle.mutate({ connectionId, category, enabled: v === true })}
      aria-label={`${category} subscription`}
    />
  );
  if (allowed) return checkbox;
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>{checkbox}</TooltipTrigger>
      <TooltipContent>
        {m.notifications_settings_category_locked({ permission: requiredPermission })}
      </TooltipContent>
    </Tooltip>
  );
}
