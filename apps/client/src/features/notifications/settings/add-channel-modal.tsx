import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircleIcon, PlugIcon, TriangleAlertIcon } from "lucide-react";

import { ConnectionModal, type PluginSummary } from "@/features/connections";
import { api } from "@/shared/lib/api";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { CapabilityBadges } from "@/shared/lib/capabilities";
import { m } from "@/paraglide/messages";

import { fetchPlugins } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";

interface Props {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}

export function AddChannelModal({ open, onOpenChange }: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<PluginSummary | null>(null);

  // Reset the selected plugin whenever the outer dialog closes so reopening
  // lands back on the picker instead of the previously chosen ConnectionModal.
  useEffect(() => {
    if (!open) setSelected(null);
  }, [open]);

  const notifPluginsQuery = useQuery({
    queryKey: notificationsKeys.plugins(),
    queryFn: fetchPlugins,
    enabled: open,
  });

  // The notifications endpoint returns a slim shape; ConnectionModal wants the
  // full PluginSummary (version, capabilities, schema). Fetch it from the
  // existing connections endpoint and intersect the two id sets.
  const availableQuery = useQuery({
    queryKey: ["connections", "available"],
    queryFn: async () => {
      const res = await api.connections.available.$get();
      if (!res.ok) throw new Error("Failed to load available plugins.");
      const body = await res.json();
      return body.plugins;
    },
    enabled: open,
  });

  const eligiblePlugins = useMemo<PluginSummary[]>(() => {
    const notifIds = new Set((notifPluginsQuery.data?.plugins ?? []).map((p) => p.id));
    return (availableQuery.data ?? []).filter((p) => notifIds.has(p.id));
  }, [notifPluginsQuery.data, availableQuery.data]);

  const isLoading = notifPluginsQuery.isLoading || availableQuery.isLoading;
  const isError = notifPluginsQuery.isError || availableQuery.isError;

  const handleSuccess = () => {
    void qc.invalidateQueries({ queryKey: notificationsKeys.channels() });
    void qc.invalidateQueries({ queryKey: notificationsKeys.subscriptions() });
    void qc.invalidateQueries({ queryKey: ["connections", "list"] });
    void qc.invalidateQueries({ queryKey: ["connections", "available"] });
    setSelected(null);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open && !selected} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-110">
          <DialogHeader className="shrink-0 border-b border-border px-6 pt-5 pb-4">
            <DialogTitle>{m.notifications_settings_add_channel_title()}</DialogTitle>
            <DialogDescription>
              {m.notifications_settings_add_channel_description()}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-4">
            <PickerBody
              isLoading={isLoading}
              isError={isError}
              plugins={eligiblePlugins}
              onPick={setSelected}
            />
          </div>
        </DialogContent>
      </Dialog>

      <ConnectionModal
        open={open && selected !== null}
        plugin={selected}
        onOpenChange={(next) => {
          if (!next) {
            setSelected(null);
            onOpenChange(false);
          }
        }}
        onSuccess={handleSuccess}
      />
    </>
  );
}

interface PickerBodyProps {
  isLoading: boolean;
  isError: boolean;
  plugins: PluginSummary[];
  onPick: (p: PluginSummary) => void;
}

function PickerBody({ isLoading, isError, plugins, onPick }: PickerBodyProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
        <LoaderCircleIcon className="size-4 animate-spin" />
        <span>{m.notifications_settings_add_channel_loading()}</span>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        <TriangleAlertIcon className="mt-0.5 size-4" aria-hidden="true" />
        <span>{m.notifications_settings_add_channel_load_failed()}</span>
      </div>
    );
  }
  if (plugins.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-9 text-center">
        <div className="flex size-10 items-center justify-center rounded-xl border border-border bg-card">
          <PlugIcon className="size-5 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium">{m.notifications_settings_add_channel_empty_title()}</p>
        <p className="max-w-[42ch] text-xs text-muted-foreground">
          {m.notifications_settings_add_channel_empty_body()}
        </p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {plugins.map((plugin) => (
        <li key={plugin.id}>
          <PluginRow plugin={plugin} onPick={onPick} />
        </li>
      ))}
    </ul>
  );
}

function PluginRow({
  plugin,
  onPick,
}: {
  plugin: PluginSummary;
  onPick: (p: PluginSummary) => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onPick(plugin)}
      className="h-auto w-full justify-start gap-3 rounded-lg border border-border bg-card px-3 py-3 text-left hover:bg-muted"
    >
      {plugin.logoUrl ? (
        <img
          src={plugin.logoUrl}
          alt=""
          className="mt-0.5 size-5 shrink-0 rounded-sm object-contain"
        />
      ) : (
        <PlugIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{plugin.name}</span>
          <span className="text-xs font-normal tracking-wide text-muted-foreground">
            v{plugin.version}
          </span>
        </div>
        {plugin.description ? (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {plugin.description}
          </p>
        ) : null}
        {plugin.userScopedCapabilities.length > 0 ? (
          <CapabilityBadges entries={plugin.userScopedCapabilities} size="sm" />
        ) : null}
      </div>
    </Button>
  );
}
