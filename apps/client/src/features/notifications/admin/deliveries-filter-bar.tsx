import { startTransition, useDeferredValue, useEffect, useState } from "react";
import type {
  NotificationCategory,
  NotificationDeliveryStatus,
  NotificationSeverity,
} from "@ent-mcp/shared/notifications";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { m } from "@/paraglide/messages";
import type { AdminDeliveryFilters } from "../shared/types";

interface Props {
  filters: AdminDeliveryFilters;
  onFiltersChange: (next: AdminDeliveryFilters) => void;
}

const STATUSES: NotificationDeliveryStatus[] = ["pending", "in_progress", "succeeded", "failed"];
const CATEGORIES: NotificationCategory[] = ["media", "sync", "auth", "system"];
const SEVERITIES: NotificationSeverity[] = ["info", "warn", "error"];

const STATUS_LABELS: Record<NotificationDeliveryStatus, () => string> = {
  pending: () => m.notifications_admin_status_pending(),
  in_progress: () => m.notifications_admin_status_in_progress(),
  succeeded: () => m.notifications_admin_status_succeeded(),
  failed: () => m.notifications_admin_status_failed(),
};

// fallow-ignore-next-line complexity
export function DeliveriesFilterBar({ filters, onFiltersChange }: Props) {
  const [userId, setUserId] = useState(filters.recipientUserId ?? "");
  const deferredUserId = useDeferredValue(userId);

  useEffect(() => {
    const trimmed = deferredUserId.trim();
    if ((filters.recipientUserId ?? "") === trimmed) return;
    const next = { ...filters };
    if (trimmed) next.recipientUserId = trimmed;
    else delete next.recipientUserId;
    onFiltersChange(next);
  }, [deferredUserId, filters, onFiltersChange]);

  const onChange = <K extends keyof AdminDeliveryFilters>(
    key: K,
    value: AdminDeliveryFilters[K] | undefined,
  ) => {
    startTransition(() => {
      const next = { ...filters };
      if (value === undefined || value === ("all" as unknown as AdminDeliveryFilters[K])) {
        delete next[key];
      } else {
        next[key] = value;
      }
      onFiltersChange(next);
    });
  };

  return (
    <div className="flex flex-wrap items-end gap-3 px-4 pb-3 pt-1">
      <div className="flex flex-col gap-1">
        <Label className="text-xs">{m.notifications_admin_filter_status()}</Label>
        <Select
          value={filters.status ?? "all"}
          onValueChange={(v) =>
            onChange("status", v === "all" ? undefined : (v as NotificationDeliveryStatus))
          }
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">{m.notifications_admin_filter_category()}</Label>
        <Select
          value={filters.category ?? "all"}
          onValueChange={(v) =>
            onChange("category", v === "all" ? undefined : (v as NotificationCategory))
          }
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">{m.notifications_admin_filter_severity()}</Label>
        <Select
          value={filters.severity ?? "all"}
          onValueChange={(v) =>
            onChange("severity", v === "all" ? undefined : (v as NotificationSeverity))
          }
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {SEVERITIES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs" htmlFor="filter-user">
          {m.notifications_admin_filter_user()}
        </Label>
        <Input
          id="filter-user"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="h-8 w-48"
        />
      </div>
    </div>
  );
}
