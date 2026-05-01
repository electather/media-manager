import { XIcon } from "lucide-react";
import { Trans, useLingui } from "@lingui/react/macro";
import { cn } from "@/shared/lib/utils";
import { Button, buttonVariants } from "@/shared/ui/button";
import { relativeTime } from "@/shared/lib/relative-time";
import { NotificationSeverityIcon } from "./notification-severity-icon";
import { CATEGORY_META, SEVERITY_META } from "./notification-panel-types";
import type { Density, Intensity, NotificationItemDto } from "./notification-panel-types";
import Markdown from "react-markdown";

interface Props {
  item: NotificationItemDto;
  density: Density;
  intensity: Intensity;
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
}

function actionVariant(style: string | undefined): "default" | "destructive" | "outline" {
  if (style === "primary") return "default";
  if (style === "danger") return "destructive";
  return "outline";
}

function ItemBody({ item, compact }: { item: NotificationItemDto; compact: boolean }) {
  const cls = cn("text-xs leading-relaxed text-muted-foreground", compact && "line-clamp-1");
  if (item.bodyMarkdown) {
    return (
      <div className={cls}>
        <Markdown>{item.bodyMarkdown}</Markdown>
      </div>
    );
  }
  return <p className={cls}>{item.body}</p>;
}

function ItemActions({ actions }: { actions: NotificationItemDto["actions"] }) {
  if (!actions?.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {actions.map((action) => (
        <a
          key={action.label}
          href={action.url}
          onClick={(e) => e.stopPropagation()}
          className={cn(buttonVariants({ variant: actionVariant(action.style), size: "xs" }))}
        >
          {action.label}
        </a>
      ))}
    </div>
  );
}

// fallow-ignore-next-line complexity
export function NotificationItem({ item, density, intensity, onMarkRead, onDismiss }: Props) {
  const { i18n, t } = useLingui();
  const isUnread = item.readAt === null;
  const isLoud = intensity === "loud" && (item.severity === "warn" || item.severity === "error");
  const { loudBg, loudBorder } = SEVERITY_META[item.severity];
  const { Icon: CatIcon, label: catLabel } = CATEGORY_META[item.category];
  const compact = density === "compact";

  return (
    <div
      role="listitem"
      onMouseEnter={() => {
        if (isUnread) onMarkRead(item.id);
      }}
      onFocus={() => {
        if (isUnread) onMarkRead(item.id);
      }}
      className={cn(
        "group/item relative grid cursor-default select-none grid-cols-[auto_1fr_auto] gap-3 border-l-2 transition-colors",
        compact ? "px-3.5 py-2.5" : "px-3.5 py-3.5",
        isLoud ? cn(loudBg, loudBorder) : "border-l-transparent hover:bg-muted/50",
      )}
    >
      <NotificationSeverityIcon severity={item.severity} />

      <div className={cn("flex min-w-0 flex-col", compact ? "gap-0.5" : "gap-1.5")}>
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
            {item.audienceKind === "admin" && (
              <span className="shrink-0 rounded border border-border bg-muted/50 px-1 py-0.5 text-xs font-medium tracking-wide text-muted-foreground/60 uppercase">
                <Trans>Admin</Trans>
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="text-xs tabular-nums text-muted-foreground">
              {relativeTime(item.createdAt)}
            </span>
            {isUnread && (
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
            )}
          </div>
        </div>

        <ItemBody item={item} compact={compact} />

        {item.image && !compact && (
          <div className="mt-1 aspect-video overflow-hidden rounded-lg border border-border bg-muted">
            <img
              src={item.image.url}
              alt={item.image.alt ?? ""}
              className="size-full object-cover"
            />
          </div>
        )}

        {!compact && <ItemActions actions={item.actions} />}

        {!compact && (
          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground/60">
            <CatIcon className="size-2.5" />
            <span>{i18n._(catLabel)}</span>
          </div>
        )}
      </div>

      <Button
        aria-label={t`Dismiss notification`}
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(item.id);
        }}
        size="xs"
        variant="ghost"
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}
