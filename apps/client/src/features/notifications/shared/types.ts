import {
  AlertCircleIcon,
  AlertTriangleIcon,
  FilmIcon,
  InfoIcon,
  RefreshCwIcon,
  ServerIcon,
  ShieldIcon,
  type LucideIcon,
} from "lucide-react";
import type {
  InboxItemDto,
  NotificationCategory,
  NotificationSeverity,
  NotificationAction,
  NotificationDeliveryStatus,
} from "@nama/shared/notifications";
import { m } from "@/paraglide/messages";
import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { BaseApiError } from "@/shared/lib/diagnostics/api-error";

export interface NotificationItemDto extends InboxItemDto {
  bodyMarkdown?: string;
  audienceKind?: "user" | "admin";
  actions?: NotificationAction[];
}

export type Density = "comfortable" | "compact";
export type Intensity = "subtle" | "loud";

export interface InboxFilters {
  unreadOnly?: boolean;
  category?: NotificationCategory;
  severity?: NotificationSeverity;
}

export interface AdminDeliveryFilters {
  status?: NotificationDeliveryStatus;
  category?: NotificationCategory;
  severity?: NotificationSeverity;
  recipientUserId?: string;
  from?: number;
  to?: number;
}

export class NotificationsApiError extends BaseApiError {
  constructor(status: number, body: ApiErrorBody | null) {
    super("NotificationsApiError", status, body, `notifications request failed (${status})`);
  }
}

export interface CategoryMeta {
  Icon: LucideIcon;
}

const CATEGORY_LABEL_FNS = {
  media: () => m.notifications_category_media(),
  sync: () => m.notifications_category_sync(),
  auth: () => m.notifications_category_auth(),
  system: () => m.notifications_category_system(),
} as const satisfies Record<NotificationCategory, () => string>;

export function categoryLabel(category: NotificationCategory): string {
  return CATEGORY_LABEL_FNS[category]();
}

export interface SeverityMeta {
  Icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  loudBorder: string;
  loudBg: string;
}

export const CATEGORY_META = {
  media: { Icon: FilmIcon },
  sync: { Icon: RefreshCwIcon },
  auth: { Icon: ShieldIcon },
  system: { Icon: ServerIcon },
} satisfies Record<NotificationCategory, CategoryMeta>;

export const SEVERITY_META = {
  info: {
    Icon: InfoIcon,
    iconBg: "bg-primary/10",
    iconColor: "text-primary",
    loudBorder: "border-l-primary",
    loudBg: "bg-primary/10",
  },
  warn: {
    Icon: AlertTriangleIcon,
    iconBg: "bg-primary/15",
    iconColor: "text-primary",
    loudBorder: "border-l-primary",
    loudBg: "bg-primary/15",
  },
  error: {
    Icon: AlertCircleIcon,
    iconBg: "bg-destructive/10",
    iconColor: "text-destructive",
    loudBorder: "border-l-destructive",
    loudBg: "bg-destructive/10",
  },
} satisfies Record<NotificationSeverity, SeverityMeta>;
