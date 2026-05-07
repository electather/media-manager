# Data layer

## Hono client (mandatory)

All fetchers MUST go through the typed Hono RPC client at `@/shared/lib/api`. Raw `fetch()` is forbidden inside `apps/client/src/features/**`.

```ts
import { api } from "@/shared/lib/api";

const res = await api.notifications.inbox.$get({ query: { limit: "50" } });
```

Rationale: end-to-end types between client and server, single auth/credentials path, single place to refactor route shape.

Exception: streaming/SSE/uploads — document the reason inline above the `fetch()` call. If you find yourself reaching for raw `fetch()` more than once, bring it up — likely needs an `api.*` route.

## Fetchers

All API calls live in:

- Split layout: `<feature>/shared/fetchers.ts`
- Flat layout: `<feature>/lib/fetchers.ts`

Each fetcher is a thin wrapper. On non-2xx, call a single `throwOnError` helper that builds the typed error class.

```ts
import { api } from "@/shared/lib/api";
import { safeJson } from "@/shared/lib/errors/safe-json";
import {
  NotificationsApiError,
  type InboxFilters,
  type NotificationsApiErrorBody,
} from "./types";

async function throwOnError(res: Response): Promise<never> {
  const body = (await safeJson(res)) as NotificationsApiErrorBody | null;
  throw new NotificationsApiError(res.status, body);
}

export async function fetchInboxPage(filters: InboxFilters, cursor: string | null) {
  const res = await api.notifications.inbox.$get({ query: inboxQuery(filters, cursor) });
  if (!res.ok) await throwOnError(res);
  return res.json();
}
```

Reference: [`apps/client/src/features/notifications/shared/fetchers.ts`](../../../../apps/client/src/features/notifications/shared/fetchers.ts).

Rules:

- No fetch logic inside hooks or components.
- Helpers that build query objects (e.g. `inboxQuery`) live alongside the fetchers.
- One fetcher per endpoint; name it `fetch<Verb><Noun>` (`fetchInboxPage`, `fetchMarkRead`, `fetchToggleSubscription`).

## Typed error class

One class per feature in `types.ts`:

```ts
export interface NotificationsApiErrorBody {
  code?: string;
  message?: string;
  [k: string]: unknown;
}

export class NotificationsApiError extends Error {
  readonly status: number;
  readonly body: NotificationsApiErrorBody | null;
  readonly code: string | undefined;

  constructor(status: number, body: NotificationsApiErrorBody | null) {
    super(body?.message ?? `notifications request failed (${status})`);
    this.name = "NotificationsApiError";
    this.status = status;
    this.body = body;
    this.code = typeof body?.code === "string" ? body.code : undefined;
  }
}
```

The feature ErrorBoundary fallback narrows on the typed class to read `body.message`/`code`. Don't parse strings.

## Query-keys factory

Hierarchical const object. Filters become part of the key. Sub-areas (admin/user) get nested groups.

```ts
import type { AdminDeliveryFilters, InboxFilters } from "./types";

export const notificationsKeys = {
  all: ["notifications"] as const,
  unreadCount: () => [...notificationsKeys.all, "unread-count"] as const,
  inbox: (filters: InboxFilters) => [...notificationsKeys.all, "inbox", filters] as const,
  inboxAll: () => [...notificationsKeys.all, "inbox"] as const,
  popoverInbox: (filters: InboxFilters) =>
    [...notificationsKeys.all, "inbox", "popover", filters] as const,
  channels: () => [...notificationsKeys.all, "channels"] as const,
  categories: () => [...notificationsKeys.all, "categories"] as const,
  subscriptions: () => [...notificationsKeys.all, "subscriptions"] as const,
  admin: {
    deliveries: (filters: AdminDeliveryFilters) =>
      [...notificationsKeys.all, "admin", "deliveries", filters] as const,
    deliveriesAll: () => [...notificationsKeys.all, "admin", "deliveries"] as const,
    delivery: (id: string) => [...notificationsKeys.all, "admin", "delivery", id] as const,
    settings: () => [...notificationsKeys.all, "admin", "settings"] as const,
  },
} as const;
```

Reference: [`apps/client/src/features/notifications/shared/query-keys.ts`](../../../../apps/client/src/features/notifications/shared/query-keys.ts).

Patterns:

- `all` is the root prefix — invalidate it to clear the entire feature cache.
- `<thing>All()` returns the prefix without the filter discriminator — use it to match every variant of a list (`inboxAll()` matches `inbox(filters)` for any filters).
- `(filters: T)` getters take the filter object as the discriminator.
- Nested groups (`admin: {...}`) for surfaces with their own URL hierarchy.

Forbidden:

- Inline `["foo", "bar"]` arrays at call sites.
- Re-creating the same key shape in two places.

## Types file

`types.ts` (split: `shared/types.ts`; flat: `lib/types.ts`) holds:

- Local DTOs that extend the wire types from `@ent-mcp/shared/<domain>`.
- The typed error class + body interface.
- Filter interfaces used by both keys and fetchers.
- Enum label functions: `categoryLabel(category)` returns the i18n string via `m.*`.
- META maps: `CATEGORY_META`, `SEVERITY_META` — icon + tailwind tokens per enum value.

Reference: [`apps/client/src/features/notifications/shared/types.ts`](../../../../apps/client/src/features/notifications/shared/types.ts).

## See also

- [`react-query.md`](react-query.md) for how hooks consume fetchers + keys.
- [`composition.md`](composition.md) for ErrorBoundary placement.
- Companion skills section in [`SKILL.md`](../SKILL.md).
