import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { LoaderCircleIcon, PlugIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { CapabilityBadges } from "@/shared/lib/capabilities";
import { ConnectionModal, type PluginSummary } from "@/features/connections";
import { m } from "@/paraglide/messages";

import { fetchAvailableConnections, fetchPlugins } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddChannelModal({ open, onOpenChange }: Props) {
  // Notification-capable plugin ids come from `/api/notifications/plugins`,
  // which is already prefetched by the route loader; this hook only re-reads
  // the cache. The full `PluginSummary` shape `ConnectionModal` consumes
  // lives on `/api/connections/available`, so we fetch both and intersect
  // by id rather than asking the server to widen the notifications response.
  const { data: notifPlugins } = useSuspenseQuery({
    queryKey: notificationsKeys.plugins(),
    queryFn: fetchPlugins,
  });

  // Available connections are pulled lazily — they're only needed when the
  // user actually opens the picker, and we don't want to inflate the initial
  // settings load. `enabled: open` keeps it gated until the dialog opens.
  const available = useQuery({
    queryKey: notificationsKeys.availableConnections(),
    queryFn: fetchAvailableConnections,
    enabled: open,
  });

  const capableIds = useMemo(
    () => new Set(notifPlugins.plugins.map((p) => p.id)),
    [notifPlugins.plugins],
  );
  const candidates = useMemo<PluginSummary[]>(() => {
    if (!available.data) return [];
    return available.data.plugins.filter((p) => capableIds.has(p.id));
  }, [available.data, capableIds]);

  const [selected, setSelected] = useState<PluginSummary | null>(null);
  const qc = useQueryClient();

  const handleSuccess = () => {
    void qc.invalidateQueries({ queryKey: notificationsKeys.channels() });
    void qc.invalidateQueries({ queryKey: notificationsKeys.subscriptions() });
    setSelected(null);
    onOpenChange(false);
  };

  const handlePickerOpenChange = (next: boolean) => {
    if (!next) setSelected(null);
    onOpenChange(next);
  };

  // Selecting a plugin swaps the picker for `ConnectionModal`. `selected`
  // doubles as the open flag for the inner modal — closing it (cancel or
  // success) returns to the picker via `setSelected(null)`.
  return (
    <>
      <Dialog open={open && selected === null} onOpenChange={handlePickerOpenChange}>
        <DialogContent className="gap-0 p-0 sm:max-w-110">
          <DialogHeader className="border-b border-border px-6 pt-5 pb-4">
            <DialogTitle>{m.notifications_settings_add_channel_title()}</DialogTitle>
            <DialogDescription>
              {m.notifications_settings_add_channel_description()}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 p-4">
            {available.isPending ? (
              <PickerSkeleton />
            ) : candidates.length === 0 ? (
              <PickerEmpty />
            ) : (
              candidates.map((plugin) => (
                <PluginPickerRow
                  key={plugin.id}
                  plugin={plugin}
                  onSelect={() => setSelected(plugin)}
                />
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConnectionModal
        open={selected !== null}
        plugin={selected}
        existing={null}
        onOpenChange={(next) => {
          if (!next) setSelected(null);
        }}
        onSuccess={handleSuccess}
      />
    </>
  );
}

function PluginPickerRow({ plugin, onSelect }: { plugin: PluginSummary; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group/picker flex items-start gap-3 rounded-lg border border-border px-3 py-3 text-start transition-colors hover:bg-muted"
    >
      {plugin.logoUrl ? (
        <img src={plugin.logoUrl} alt="" className="mt-0.5 size-5 rounded-sm object-contain" />
      ) : (
        <PlugIcon className="mt-0.5 size-5 text-muted-foreground" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm font-medium">{plugin.name}</span>
        {plugin.description ? (
          <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {plugin.description}
          </span>
        ) : null}
        {plugin.userScopedCapabilities.length > 0 ? (
          <CapabilityBadges entries={plugin.userScopedCapabilities} size="sm" />
        ) : null}
      </div>
      <span
        className="shrink-0 self-center rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground group-hover/picker:border-foreground/40 group-hover/picker:text-foreground"
        aria-hidden="true"
      >
        {m.notifications_settings_add_channel_select()}
      </span>
    </button>
  );
}

function PickerSkeleton() {
  return (
    <div className="flex items-center justify-center py-8 text-muted-foreground">
      <LoaderCircleIcon className="size-5 animate-spin" />
    </div>
  );
}

function PickerEmpty() {
  return (
    <p className="px-2 py-6 text-center text-sm text-muted-foreground">
      {m.notifications_settings_add_channel_empty()}
    </p>
  );
}
