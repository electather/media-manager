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
        <HeaderLogo url={plugin.logoUrl} />
        <div className="flex flex-1 flex-col gap-0.5">
          <Title className={cn("text-base")}>{title}</Title>
          <HeaderDescription Description={Description} text={plugin.description} />
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
      <HeaderCapabilities plugin={plugin} />
    </div>
  );
}

function HeaderLogo({ url }: { url: string | null | undefined }) {
  if (!url) return null;
  return <img src={url} alt="" className="mt-0.5 size-9 rounded-md object-contain" />;
}

function HeaderDescription({
  Description,
  text,
}: {
  Description: ComponentType<SlotProps>;
  text: string | null | undefined;
}) {
  if (!text) return null;
  return <Description>{text}</Description>;
}

function HeaderCapabilities({ plugin }: { plugin: PluginSummary }) {
  return (
    <>
      <UserCapabilities entries={plugin.userScopedCapabilities} />
      <GlobalCapabilities entries={plugin.globalScopedCapabilities} />
    </>
  );
}

function UserCapabilities({ entries }: { entries: PluginSummary["userScopedCapabilities"] }) {
  if (entries.length === 0) return null;
  return (
    <div className="mt-3">
      <CapabilityBadges entries={entries} size="sm" />
    </div>
  );
}

function GlobalCapabilities({ entries }: { entries: PluginSummary["globalScopedCapabilities"] }) {
  if (entries.length === 0) return null;
  return (
    <p className="mt-1.5 text-xs text-muted-foreground">
      <span className="sr-only">{m.settings_connections_modal_also_provides_sr_prefix()}</span>
      {m.settings_connections_modal_also_provides({
        list: capabilityListSummary(entries),
      })}
    </p>
  );
}
