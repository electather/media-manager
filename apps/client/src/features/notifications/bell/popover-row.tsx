import { XIcon } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { Button, buttonVariants } from "@/shared/ui/button";
import { relativeTime } from "@/shared/lib/time-format";
import { m } from "@/paraglide/messages";
import { SeverityIcon } from "../shared/severity-icon";
import { CATEGORY_META, SEVERITY_META, categoryLabel } from "../shared/types";
import type { Density, Intensity, NotificationItemDto } from "../shared/types";
import { useDismiss, useMarkRead } from "../inbox/use-inbox-mutations";
import { isSafeActionUrl } from "../shared/url";
import Markdown from "react-markdown";

interface Props {
  item: NotificationItemDto;
  density: Density;
  intensity: Intensity;
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
  const safeActions = actions.filter((a) => isSafeActionUrl(a.url));
  if (!safeActions.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {safeActions.map((action, i) => (
        <a
          key={`${i}-${action.url}`}
          href={action.url}
          target="_blank"
          rel="noopener noreferrer"
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
export function PopoverRow({ item, density, intensity }: Props) {
  const isUnread = item.readAt === null;
  const isLoud = intensity === "loud" && (item.severity === "warn" || item.severity === "error");
  const { loudBg, loudBorder } = SEVERITY_META[item.severity];
  const { Icon: CatIcon } = CATEGORY_META[item.category];
  const catLabel = categoryLabel(item.category);
  const compact = density === "compact";
  const markRead = useMarkRead();
  const dismiss = useDismiss();
  const onMarkReadHover = () => {
    if (isUnread) markRead.mutate([item.id]);
  };

  return (
    <div
      role="listitem"
      onMouseEnter={onMarkReadHover}
      onFocus={onMarkReadHover}
      className={cn(
        "group/item relative grid cursor-default select-none grid-cols-[auto_1fr_auto] gap-3 border-l-2 transition-colors",
        compact ? "px-3.5 py-2.5" : "px-3.5 py-3.5",
        isLoud ? cn(loudBg, loudBorder) : "border-l-transparent hover:bg-muted/50",
      )}
    >
      <SeverityIcon severity={item.severity} />

      <div className={cn("flex min-w-0 flex-col", compact ? "gap-0.5" : "gap-1.5")}>
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
            {item.audienceKind === "admin" && (
              <span className="shrink-0 rounded border border-border bg-muted/50 px-1 py-0.5 text-xs font-medium tracking-wide text-muted-foreground/60 uppercase">
                {m.notifications_admin_badge()}
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
            <span>{catLabel}</span>
          </div>
        )}
      </div>

      <Button
        aria-label={m.notifications_dismiss_aria()}
        onClick={(e) => {
          e.stopPropagation();
          dismiss.mutate([item.id]);
        }}
        size="xs"
        variant="ghost"
      >
        <XIcon className="size-3.5" />
      </Button>
    </div>
  );
}
