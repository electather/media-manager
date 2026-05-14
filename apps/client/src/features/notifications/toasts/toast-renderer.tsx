import { XIcon } from "lucide-react";
import { toast as sonnerToast } from "sonner";
import { useNavigate } from "@tanstack/react-router";
import { m } from "@/paraglide/messages";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { SeverityIcon } from "../shared/severity-icon";
import type { NotificationItemDto } from "../shared/types";
import type { MarkReadMutation } from "../inbox/use-inbox-mutations";
import type { ToastBroadcast } from "./use-toast-broadcast";

const TOAST_BODY_MAX_CHARS = 140;
// Errors stay sticky for 30s — long enough to read without auto-dismissing,
// but bounded so a delivery burst can't pin a stack of toasts to the viewport.
const TOAST_DURATION_BY_SEVERITY = { error: 30_000, warn: 5_000 } as const;

export interface ToastDeps {
  navigate: ReturnType<typeof useNavigate>;
  markReadMutation: MarkReadMutation;
  broadcast: ToastBroadcast;
}

interface CardProps {
  item: NotificationItemDto;
  onClick: () => void;
  onDismiss: () => void;
}

export function NotificationToastCard({ item, onClick, onDismiss }: CardProps) {
  const body =
    item.body.length > TOAST_BODY_MAX_CHARS
      ? `${item.body.slice(0, TOAST_BODY_MAX_CHARS)}…`
      : item.body;

  return (
    <div className="flex w-full items-start gap-3 rounded-lg border bg-background p-3 shadow-md">
      <button
        type="button"
        className={cn("flex min-w-0 flex-1 cursor-pointer select-none items-start gap-3 text-left")}
        onClick={onClick}
      >
        <SeverityIcon severity={item.severity} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{body}</p>
        </div>
      </button>
      <Button
        aria-label={m.notifications_toast_dismiss_aria()}
        size="xs"
        variant="ghost"
        onClick={onDismiss}
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}

export function renderToast(item: NotificationItemDto, deps: ToastDeps): void {
  const { navigate, markReadMutation, broadcast } = deps;
  const toastId = `notif:${item.id}`;
  const duration =
    item.severity === "error" ? TOAST_DURATION_BY_SEVERITY.error : TOAST_DURATION_BY_SEVERITY.warn;

  sonnerToast.custom(
    (id) => (
      <NotificationToastCard
        item={item}
        onClick={() => {
          markReadMutation.mutate([item.id]);
          if (item.actionUrl) void navigate({ to: item.actionUrl });
          sonnerToast.dismiss(id);
        }}
        onDismiss={() => sonnerToast.dismiss(id)}
      />
    ),
    { duration, id: toastId },
  );
  broadcast.publish(item.id);
}

let clusterSeq = 0;

export function renderClusterToast(overflowCount: number, deps: ToastDeps): void {
  const { navigate } = deps;
  const toastId = `notif:cluster:${overflowCount}:${++clusterSeq}`;

  sonnerToast.custom(
    (id) => (
      <button
        type="button"
        className="flex w-full cursor-pointer items-center gap-3 rounded-lg border bg-background p-3 text-start shadow-md"
        onClick={() => {
          void navigate({ to: "/notifications" });
          sonnerToast.dismiss(id);
        }}
      >
        <p className="text-sm font-medium text-foreground">
          {m.notifications_toast_cluster_title({ count: overflowCount })}
        </p>
      </button>
    ),
    { duration: 5_000, id: toastId },
  );
}
