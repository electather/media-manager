import { startTransition } from "react";
import { CheckCheckIcon, Trash2Icon } from "lucide-react";
import type { NotificationCategory, NotificationSeverity } from "@ent-mcp/shared/notifications";
import { Button } from "@/shared/ui/button";
import { RadioGroup } from "@/shared/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { m } from "@/paraglide/messages";
import { CategoryChip } from "../shared/category-chip";
import { CATEGORY_META, categoryLabel } from "../shared/types";
import type { InboxFilters } from "../shared/types";
import { useDeleteInboxAll, useMarkAllRead } from "./use-inbox-mutations";

interface Props {
  filters: InboxFilters;
  unreadCount: number;
  onFiltersChange: (next: InboxFilters) => void;
}

const CATEGORY_KEYS = Object.keys(CATEGORY_META) as NotificationCategory[];
const SEVERITY_KEYS: NotificationSeverity[] = ["info", "warn", "error"];

const SEVERITY_LABELS: Record<NotificationSeverity, () => string> = {
  info: () => m.notifications_filter_severity_info(),
  warn: () => m.notifications_filter_severity_warn(),
  error: () => m.notifications_filter_severity_error(),
};

// fallow-ignore-next-line complexity
export function InboxToolbar({ filters, unreadCount, onFiltersChange }: Props) {
  const markAllRead = useMarkAllRead();
  const deleteRead = useDeleteInboxAll();

  const onCategoryChange = (v: string) => {
    startTransition(() => {
      const next: InboxFilters = { ...filters };
      if (v === "all") delete next.category;
      else next.category = v as NotificationCategory;
      onFiltersChange(next);
    });
  };

  const onSeverityChange = (v: string | null) => {
    startTransition(() => {
      const next: InboxFilters = { ...filters };
      if (!v || v === "all") delete next.severity;
      else next.severity = v as NotificationSeverity;
      onFiltersChange(next);
    });
  };

  const onUnreadToggle = () => {
    startTransition(() => {
      onFiltersChange({ ...filters, unreadOnly: !filters.unreadOnly });
    });
  };

  return (
    <div className="flex flex-col gap-3 px-4 pb-3 pt-1">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-1 items-center gap-3 overflow-x-auto">
          <RadioGroup
            value={filters.category ?? "all"}
            onValueChange={onCategoryChange}
            aria-label={m.notifications_filter_aria()}
            className="flex-nowrap"
          >
            <CategoryChip value="all" label={m.notifications_category_all()} />
            {CATEGORY_KEYS.map((k) => (
              <CategoryChip key={k} value={k} category={k} label={categoryLabel(k)} />
            ))}
          </RadioGroup>
          <Select value={filters.severity ?? "all"} onValueChange={onSeverityChange}>
            <SelectTrigger size="sm" aria-label={m.notifications_filter_severity_aria()}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{m.notifications_filter_severity_all()}</SelectItem>
              {SEVERITY_KEYS.map((s) => (
                <SelectItem key={s} value={s}>
                  {SEVERITY_LABELS[s]()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={filters.unreadOnly ? "default" : "outline"}
            size="sm"
            onClick={onUnreadToggle}
          >
            {m.notifications_unread_count({ count: unreadCount })}
          </Button>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={unreadCount === 0}
            onClick={() =>
              markAllRead.mutate(filters.category ? { category: filters.category } : {})
            }
          >
            <CheckCheckIcon className="size-4" />
            {m.notifications_mark_all_read()}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => deleteRead.mutate({ readOnly: true })}>
            <Trash2Icon className="size-4" />
            {m.notifications_delete_read()}
          </Button>
        </div>
      </div>
    </div>
  );
}
