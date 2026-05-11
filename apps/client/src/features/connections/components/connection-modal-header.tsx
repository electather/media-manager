import type { ComponentType, ReactNode } from "react";
import { XIcon } from "lucide-react";

import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { CapabilityBadges, capabilityListSummary } from "@/shared/lib/capabilities";
import { cn } from "@/shared/lib/utils";

import type { PluginSummary } from "../lib/types";

interface SlotProps {
  children: ReactNode;
  className?: string;
}

interface Props {
  plugin: PluginSummary;
  isEdit: boolean;
  canClose: boolean;
  onClose: () => void;
  /**
   * Title primitive scoped to the surrounding dialog/drawer. Provided so the
   * header works whether mounted in a `<Sheet>` or `<Drawer>` root — base-ui
   * uses these to wire `aria-labelledby` to the dialog.
   */
  Title: ComponentType<SlotProps>;
  Description: ComponentType<SlotProps>;
}

export function ConnectionModalHeader({
  plugin,
  isEdit,
  canClose,
  onClose,
  Title,
  Description,
}: Props) {
  const title = isEdit
    ? m.settings_connections_modal_title_edit({ name: plugin.name })
    : m.settings_connections_modal_title_add({ name: plugin.name });

  return (
    <div className="shrink-0 border-b border-border px-6 pt-5 pb-4">
      <div className="flex items-start gap-3">
        {plugin.logoUrl ? (
          <img src={plugin.logoUrl} alt="" className="mt-0.5 size-9 rounded-md object-contain" />
        ) : null}
        <div className="flex flex-1 flex-col gap-0.5">
          <Title className={cn("text-base")}>{title}</Title>
          {plugin.description ? <Description>{plugin.description}</Description> : null}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={m.settings_connections_modal_close()}
          onClick={onClose}
          disabled={!canClose}
          className="shrink-0"
        >
          <XIcon className="size-4" aria-hidden="true" />
        </Button>
      </div>
      {plugin.userScopedCapabilities.length > 0 ? (
        <div className="mt-3">
          <CapabilityBadges entries={plugin.userScopedCapabilities} size="sm" />
        </div>
      ) : null}
      {plugin.globalScopedCapabilities.length > 0 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          <span className="sr-only">{m.settings_connections_modal_also_provides_sr_prefix()}</span>
          {m.settings_connections_modal_also_provides({
            list: capabilityListSummary(plugin.globalScopedCapabilities),
          })}
        </p>
      ) : null}
    </div>
  );
}
