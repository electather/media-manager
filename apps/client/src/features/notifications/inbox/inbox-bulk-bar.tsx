import { CheckCheckIcon, MailIcon, Trash2Icon, XIcon } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { m } from "@/paraglide/messages";
import { useDismiss, useMarkRead, useMarkUnread } from "./use-inbox-mutations";

interface Props {
  ids: string[];
  onClear: () => void;
}

export function InboxBulkBar({ ids, onClear }: Props) {
  const markRead = useMarkRead();
  const markUnread = useMarkUnread();
  const dismiss = useDismiss();

  if (ids.length === 0) return null;

  const after = (action: () => void) => () => {
    action();
    onClear();
  };

  return (
    <div className="sticky bottom-4 mx-4 flex items-center justify-between gap-3 rounded-lg border border-border bg-popover/95 px-4 py-2 shadow-lg backdrop-blur">
      <span className="text-sm">{m.notifications_bulk_count({ count: ids.length })}</span>
      <div className="flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={after(() => markRead.mutate(ids))}
          aria-label={m.notifications_bulk_mark_read()}
        >
          <CheckCheckIcon className="size-4" />
          {m.notifications_bulk_mark_read()}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={after(() => markUnread.mutate(ids))}
          aria-label={m.notifications_bulk_mark_unread()}
        >
          <MailIcon className="size-4" />
          {m.notifications_bulk_mark_unread()}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={after(() => dismiss.mutate(ids))}
          aria-label={m.notifications_bulk_delete()}
        >
          <Trash2Icon className="size-4" />
          {m.notifications_bulk_delete()}
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="Clear selection">
          <XIcon className="size-4" />
        </Button>
      </div>
    </div>
  );
}
