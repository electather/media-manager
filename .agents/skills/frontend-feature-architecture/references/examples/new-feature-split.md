# Example — split feature (2+ surfaces)

Hypothetical `alerts` feature: user inbox surface + admin deliveries surface. Mirrors `notifications` shape.

## Layout

```
features/alerts/
├── index.ts
├── shared/
│   ├── fetchers.ts
│   ├── query-keys.ts
│   ├── types.ts
│   ├── error-boundary.tsx
│   └── severity-icon.tsx
├── inbox/
│   ├── inbox-page.tsx
│   ├── inbox-list.tsx
│   ├── inbox-row.tsx
│   ├── inbox-skeleton.tsx
│   ├── inbox-empty.tsx
│   ├── use-inbox.ts
│   └── use-inbox-mutations.ts
├── admin/
│   ├── deliveries-page.tsx
│   ├── deliveries-table.tsx
│   ├── delivery-row.tsx
│   ├── deliveries-skeleton.tsx
│   ├── use-admin-deliveries.ts
│   └── use-retry-delivery.ts
└── __tests__/...
```

## `shared/types.ts`

```ts
import type { AlertDto, AlertSeverity } from "@nama/shared/alerts";
import { m } from "@/paraglide/messages";

export interface InboxFilters { unreadOnly?: boolean; severity?: AlertSeverity }
export interface AdminDeliveryFilters { status?: string; severity?: AlertSeverity }

export interface AlertsApiErrorBody {
  code?: string; message?: string; [k: string]: unknown;
}

export class AlertsApiError extends Error {
  readonly status: number;
  readonly body: AlertsApiErrorBody | null;
  readonly code: string | undefined;
  constructor(status: number, body: AlertsApiErrorBody | null) {
    super(body?.message ?? `alerts request failed (${status})`);
    this.name = "AlertsApiError";
    this.status = status;
    this.body = body;
    this.code = typeof body?.code === "string" ? body.code : undefined;
  }
}

const SEVERITY_LABEL_FNS = {
  info: () => m.alerts_severity_info(),
  warn: () => m.alerts_severity_warn(),
  error: () => m.alerts_severity_error(),
} as const satisfies Record<AlertSeverity, () => string>;

export function severityLabel(s: AlertSeverity) { return SEVERITY_LABEL_FNS[s](); }

export type { AlertDto, AlertSeverity };
```

## `shared/query-keys.ts`

```ts
import type { AdminDeliveryFilters, InboxFilters } from "./types";

export const alertsKeys = {
  all: ["alerts"] as const,
  inbox: (filters: InboxFilters) => [...alertsKeys.all, "inbox", filters] as const,
  inboxAll: () => [...alertsKeys.all, "inbox"] as const,
  unreadCount: () => [...alertsKeys.all, "unread-count"] as const,
  admin: {
    deliveries: (filters: AdminDeliveryFilters) =>
      [...alertsKeys.all, "admin", "deliveries", filters] as const,
    deliveriesAll: () => [...alertsKeys.all, "admin", "deliveries"] as const,
    delivery: (id: string) => [...alertsKeys.all, "admin", "delivery", id] as const,
  },
} as const;
```

## `shared/fetchers.ts`

```ts
import { api } from "@/shared/lib/api";
import { safeJson } from "@/shared/lib/errors/safe-json";
import {
  AlertsApiError,
  type AdminDeliveryFilters,
  type InboxFilters,
  type AlertsApiErrorBody,
} from "./types";

async function throwOnError(res: Response): Promise<never> {
  const body = (await safeJson(res)) as AlertsApiErrorBody | null;
  throw new AlertsApiError(res.status, body);
}

function inboxQuery(filters: InboxFilters, cursor: string | null) {
  return {
    ...(filters.unreadOnly ? { unreadOnly: "true" as const } : {}),
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(cursor ? { cursor } : {}),
    limit: "50",
  };
}

export async function fetchInboxPage(filters: InboxFilters, cursor: string | null) {
  const res = await api.alerts.inbox.$get({ query: inboxQuery(filters, cursor) });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchMarkRead(ids: string[]) {
  const res = await api.alerts.inbox["mark-read"].$post({ json: { ids } });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchAdminDeliveriesPage(
  filters: AdminDeliveryFilters,
  cursor: string | null,
) {
  const res = await api.admin.alerts.deliveries.$get({
    query: {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.severity ? { severity: filters.severity } : {}),
      ...(cursor ? { cursor } : {}),
      limit: "50",
    },
  });
  if (!res.ok) await throwOnError(res);
  return res.json();
}

export async function fetchRetryDelivery(id: string) {
  const res = await api.admin.alerts.deliveries[":id"].retry.$post({ param: { id } });
  if (!res.ok) await throwOnError(res);
  return res.json();
}
```

## `inbox/use-inbox.ts`

```ts
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { fetchInboxPage } from "../shared/fetchers";
import { alertsKeys } from "../shared/query-keys";
import type { InboxFilters } from "../shared/types";

export function useInbox(filters: InboxFilters) {
  return useSuspenseInfiniteQuery({
    queryKey: alertsKeys.inbox(filters),
    queryFn: ({ pageParam }) => fetchInboxPage(filters, pageParam ?? null),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      typeof last.nextCursor === "string" ? last.nextCursor : null,
  });
}
```

## `inbox/use-inbox-mutations.ts`

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchMarkRead } from "../shared/fetchers";
import { alertsKeys } from "../shared/query-keys";
import type { AlertDto } from "../shared/types";

interface InboxPage { items: AlertDto[]; unreadCount: number }
interface InboxData { pages?: InboxPage[]; pageParams?: unknown[] }

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => fetchMarkRead(ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: alertsKeys.inboxAll() });
      const snapshot = qc.getQueriesData<InboxData>({ queryKey: alertsKeys.inboxAll() });
      const idSet = new Set(ids);
      const now = Date.now();
      qc.setQueriesData<InboxData>({ queryKey: alertsKeys.inboxAll() }, (data) => {
        if (!data?.pages) return data;
        return {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.map((i) => (idSet.has(i.id) ? { ...i, readAt: now } : i)),
          })),
        };
      });
      return { snapshot };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.snapshot) for (const [key, data] of ctx.snapshot) qc.setQueryData(key, data);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: alertsKeys.inboxAll() });
      void qc.invalidateQueries({ queryKey: alertsKeys.unreadCount() });
    },
  });
}
```

## `inbox/inbox-page.tsx`

```tsx
import { Suspense, useState } from "react";
import { m } from "@/paraglide/messages";
import { AlertsErrorBoundary } from "../shared/error-boundary";
import { InboxList } from "./inbox-list";
import { InboxSkeleton } from "./inbox-skeleton";
import type { InboxFilters } from "../shared/types";

interface Props { filters: InboxFilters; onFiltersChange: (next: InboxFilters) => void }

export function InboxPage({ filters, onFiltersChange }: Props) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const onToggle = (id: string, sel: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (sel) next.add(id); else next.delete(id);
      return next;
    });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="px-4 pt-6 pb-3">
        <h1 className="text-2xl font-semibold">{m.alerts_inbox_title()}</h1>
      </header>
      <AlertsErrorBoundary>
        <Suspense fallback={<InboxSkeleton />}>
          <InboxList filters={filters} selected={selected} onToggleSelect={onToggle} />
        </Suspense>
      </AlertsErrorBoundary>
    </div>
  );
}
```

## `admin/use-admin-deliveries.ts`

```ts
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { fetchAdminDeliveriesPage } from "../shared/fetchers";
import { alertsKeys } from "../shared/query-keys";
import type { AdminDeliveryFilters } from "../shared/types";

export function useAdminDeliveries(filters: AdminDeliveryFilters) {
  return useSuspenseInfiniteQuery({
    queryKey: alertsKeys.admin.deliveries(filters),
    queryFn: ({ pageParam }) => fetchAdminDeliveriesPage(filters, pageParam ?? null),
    initialPageParam: null as string | null,
    getNextPageParam: (last: { nextCursor?: string }) =>
      typeof last.nextCursor === "string" ? last.nextCursor : null,
  });
}
```

## `admin/use-retry-delivery.ts`

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchRetryDelivery } from "../shared/fetchers";
import { alertsKeys } from "../shared/query-keys";

export function useRetryDelivery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchRetryDelivery(id),
    onSettled: (_d, _e, id) => {
      void qc.invalidateQueries({ queryKey: alertsKeys.admin.delivery(id) });
      void qc.invalidateQueries({ queryKey: alertsKeys.admin.deliveriesAll() });
    },
  });
}
```

(Retry is a low-stakes background op — invalidate-only is acceptable per rule 6.)

## `index.ts`

```ts
// Cross-feature surfaces only.
export { InboxPage } from "./inbox/inbox-page";
export { DeliveriesPage } from "./admin/deliveries-page";
```

Internal components/hooks NOT exported.

## See also

- Real reference: [`features/notifications`](../../../../../apps/client/src/features/notifications/) — same shape, ~4 surfaces.
- [`folder-layout.md`](../folder-layout.md), [`data-layer.md`](../data-layer.md), [`react-query.md`](../react-query.md), [`composition.md`](../composition.md).
