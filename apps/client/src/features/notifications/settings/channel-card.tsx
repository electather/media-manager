import { Trash2Icon } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { m } from "@/paraglide/messages";
import { ChannelTestButton } from "./channel-test-button";

interface Channel {
  id: string;
  pluginId: string;
  pluginName: string;
  displayName: string | null;
  status: string;
}

interface Props {
  channel: Channel;
  onDelete: (id: string) => void;
}

export function ChannelCard({ channel, onDelete }: Props) {
  const title = channel.displayName ?? channel.pluginName;
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{channel.pluginName}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ChannelTestButton connectionId={channel.id} />
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => onDelete(channel.id)}
          aria-label={m.notifications_settings_delete_channel()}
        >
          <Trash2Icon className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function InboxChannelCard() {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3">
      <div className="flex flex-col">
        <span className="text-sm font-medium">{m.notifications_settings_inbox_channel()}</span>
        <span className="text-xs text-muted-foreground">
          {m.notifications_settings_inbox_locked()}
        </span>
      </div>
    </div>
  );
}
