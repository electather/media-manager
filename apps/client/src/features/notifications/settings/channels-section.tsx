import { PlusIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { api } from "@/shared/lib/api";
import { m } from "@/paraglide/messages";
import { notificationsKeys } from "../shared/query-keys";
import { ChannelCard, InboxChannelCard } from "./channel-card";
import { useChannels } from "./use-channels";

export function ChannelsSection() {
  const { data } = useChannels();
  const channels = data.channels;
  const qc = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.connections[":id"].$delete({ param: { id } });
      if (!res.ok) throw new Error(`Failed to delete: ${res.status}`);
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.notifications_settings_delete_channel_failed({ message: msg }));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: notificationsKeys.channels() });
      void qc.invalidateQueries({ queryKey: notificationsKeys.subscriptions() });
    },
  });

  return (
    <section className="rounded-lg border border-border">
      <header className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
        <h2 className="text-lg font-semibold">{m.notifications_settings_channels_title()}</h2>
        <Button size="sm" variant="outline" render={<Link to="/settings/connections" />}>
          <PlusIcon className="size-4" />
          {m.notifications_settings_add_channel()}
        </Button>
      </header>
      <div className="flex flex-col gap-2 p-4">
        <InboxChannelCard />
        {channels.map((ch) => (
          <ChannelCard
            key={ch.id}
            channel={{
              id: ch.id,
              pluginId: ch.pluginId,
              pluginName: ch.pluginId,
              displayName: ch.displayName,
              status: ch.status,
            }}
            onDelete={(id) => deleteMutation.mutate(id)}
          />
        ))}
      </div>
    </section>
  );
}
