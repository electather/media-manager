import { XIcon } from "lucide-react";
import Markdown from "react-markdown";
import { cn } from "@/shared/lib/utils";
import { Button, buttonVariants } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { relativeTime } from "@/shared/lib/relative-time";
import { m } from "@/paraglide/messages";
import { SeverityIcon } from "../shared/severity-icon";
import { CATEGORY_META, SEVERITY_META, categoryLabel } from "../shared/types";
import type { NotificationItemDto } from "../shared/types";
import { useDismiss, useMarkRead } from "./use-inbox-mutations";

interface Props {
  item: NotificationItemDto;
  selected: boolean;
  onToggleSelect: (id: string, selected: boolean) => void;
}

function actionVariant(style: string | undefined): "default" | "destructive" | "outline" {
  if (style === "primary") return "default";
  if (style === "danger") return "destructive";
  return "outline";
}

function isSafeActionUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// fallow-ignore-next-line complexity
export function InboxRow({ item, selected, onToggleSelect }: Props) {
  const isUnread = item.readAt === null;
  const { Icon: CatIcon } = CATEGORY_META[item.category];
  const { loudBg, loudBorder } = SEVERITY_META[item.severity];
  const catLabel = categoryLabel(item.category);
  const markRead = useMarkRead();
  const dismiss = useDismiss();

  return (
    <div
      role="listitem"
      className={cn(
        "group/item relative grid select-none grid-cols-[auto_auto_1fr_auto] items-start gap-3 border-l-2 border-b border-border/50 px-4 py-4 transition-colors",
        item.severity === "error"
          ? cn(loudBg, loudBorder)
          : "border-l-transparent hover:bg-muted/40",
      )}
    >
      <Checkbox
        checked={selected}
        onCheckedChange={(v) => onToggleSelect(item.id, v === true)}
        aria-label={`Select notification: ${item.title}`}
      />
      <SeverityIcon severity={item.severity} />
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
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
        {item.bodyMarkdown ? (
          <div className="text-sm leading-relaxed text-muted-foreground">
            <Markdown>{item.bodyMarkdown}</Markdown>
          </div>
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">{item.body}</p>
        )}
        {item.actions && item.actions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-2">
            {item.actions
              .filter((a) => isSafeActionUrl(a.url))
              .map((a, i) => (
                <a
                  key={`${i}-${a.url}`}
                  href={a.url}
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className={cn(buttonVariants({ variant: actionVariant(a.style), size: "xs" }))}
                >
                  {a.label}
                </a>
              ))}
          </div>
        )}
        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground/70">
          <CatIcon className="size-3" />
          <span>{catLabel}</span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {isUnread && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => markRead.mutate([item.id])}
            aria-label={m.notifications_mark_read_aria()}
          >
            ✓
          </Button>
        )}
        <Button
          aria-label={m.notifications_dismiss_aria()}
          onClick={() => dismiss.mutate([item.id])}
          size="xs"
          variant="ghost"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
