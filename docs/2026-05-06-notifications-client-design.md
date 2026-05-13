# Notifications — Client UI

**Status:** Draft for review
**Date:** 2026-05-06
**Author:** Omid Astaraki
**Scope:** `apps/client/`
**Supersedes / extends:** PR 8 of `docs/2026-04-25-notifications-design.md`. Server (PRs 1–7) shipped & gated by `NOTIFICATIONS_ENABLED`. This doc = full client surface + flag flip.
**Related:** `docs/2026-04-29-frontend-structure-design.md` (feature-first layout); `docs/2026-04-24-user-settings-design.md` (settings shell + 6th tab wiring).
**Amendments:** 2026-05-10 — `/settings/notifications` inbox row = always-on virtual row, ⊥ server subscription. See § "Settings inbox row (2026-05-10)".

## Summary

Wire 5 client surfaces ⇒ existing `/api/notifications/*` & `/api/admin/notifications/*` routes. Replace fixture-driven bell popover w/ live data. Add `/notifications`, `/settings/notifications`, `/admin/notifications/deliveries`, `/admin/settings/notifications`. Flip `NOTIFICATIONS_ENABLED=true` same PR.

Stack: React 19 + TanStack Router 1.169 + TanStack Query 5.100 + Hono RPC. Concurrent-first ∀ surfaces. Bell renders shell immediately, defers fetch (¬-blocking page chrome). Routes use loader prefetch + `useSuspenseQuery` for streaming UX. Mark-read | dismiss = `useOptimistic` for instant rollback. Filter swaps wrapped in `useTransition`. Admin search via `useDeferredValue`.

Single PR. Dev-mode build straight against real API (¬ mock layer, ¬ feature-flag fallback). One feature dir `apps/client/src/features/notifications/` w/ sub-component decomposition per surface.

## Goals

- 5 user-visible surfaces wired ⇒ live API. Flag flipped same PR.
- ∀ data hooks centralised under `features/notifications/`. Sibling features ⊥ import internals.
- Concurrent-mode posture: route loaders prefetch dedicated routes, suspense + optimistic state for mutations, transitions for filter UI.
- Decompose ∀ surface into sub-component dirs (memory rule #17). ¬ flat files >250 LOC.
- `top-nav.tsx` change = 1 import rename. ⊥ break existing chrome.
- Plug into existing i18n (paraglide) & error reporting (`reportError`) plumbing.

## Non-goals

- Real-time push (SSE/WebSocket). Polling v1 (per server design §Non-goals).
- Plugin-author UX | settings i18n past `en` & `fa`.
- Custom fixture / mock layer. Server endpoints live; ⊥ build flag-fallback shim.
- Snooze, quiet hours, per-event subs, coalescing UI. ⊥ v1.
- Bulk inbox archive UI past existing `delete /inbox`, `delete /inbox/all`. Calls hit existing endpoints; ¬ new API.

## Architecture overview

```
                    ┌──────────────────────────────────────────────┐
                    │  features/notifications/                     │
                    │                                              │
                    │  shared/      query-keys, fetchers,          │
                    │               error-boundary, types          │
                    │                                              │
                    │  bell/        useUnreadCount (poll 30s)      │
                    │               popover + drawer (mobile)      │
                    │                                              │
                    │  inbox/       useInbox (suspense-infinite)   │
                    │               useMarkRead, useDismiss,       │
                    │               useMarkAllRead — useOptimistic │
                    │                                              │
                    │  settings/    usePlugins, useChannels,       │
                    │               useCategories, useSubscriptions│
                    │               useToggleSub, useTestChannel   │
                    │                                              │
                    │  admin/       useAdminDeliveries,            │
                    │               useAdminDelivery,              │
                    │               useRetryDelivery,              │
                    │               useAdminSettings + update      │
                    └──────────────────────────────────────────────┘
                                       ▲
                                       │ public surface = index.ts
                                       │
        ┌──────────────────────────────┴────────────────────────────────┐
        │ app/top-nav.tsx     →  features/notifications/bell            │
        │ routes/.../notifications.tsx                                  │
        │ routes/.../settings/notifications.tsx                         │
        │ routes/.../admin/notifications/deliveries.tsx                 │
        │ routes/.../admin/settings/notifications.tsx                   │
        └───────────────────────────────────────────────────────────────┘
```

3 layers: fetch (Hono RPC + query keys), state (TanStack Query + suspense), view (sub-component dirs). Mutations always invalidate via key tree → ∀ open queries auto-refresh.

## Directory layout

```
apps/client/src/features/notifications/
├── index.ts                         # public surface
├── shared/
│   ├── query-keys.ts                # notificationsKeys factory
│   ├── fetchers.ts                  # api.* wrappers w/ error normalisation
│   ├── types.ts                     # client-side DTO extensions
│   ├── error-boundary.tsx           # reset-on-retry suspense fallback
│   ├── relative-time-helpers.ts     # if needed past shared/relative-time
│   └── __tests__/
├── bell/
│   ├── notification-bell.tsx        # entry; replaces NotificationPanel export
│   ├── bell-trigger.tsx             # button + dot; size variants
│   ├── bell-popover-shell.tsx       # popover/drawer chrome
│   ├── use-unread-count.ts
│   ├── popover-empty-suspense.tsx   # skeleton inside popover
│   ├── __tests__/
│   └── index.ts
├── inbox/
│   ├── inbox-page.tsx               # route component
│   ├── inbox-list.tsx               # virtual list, suspense-infinite
│   ├── inbox-row.tsx                # single item; consumes useOptimistic action
│   ├── inbox-toolbar.tsx            # filter chips + unread toggle + bulk acts
│   ├── inbox-empty.tsx
│   ├── inbox-skeleton.tsx           # pendingComponent for route
│   ├── use-inbox.ts                 # useSuspenseInfiniteQuery
│   ├── use-inbox-mutations.ts       # mark-read/unread/dismiss/all + optimistic
│   ├── __tests__/
│   └── index.ts
├── settings/
│   ├── notifications-settings-page.tsx  # route component
│   ├── channels-section.tsx
│   ├── channel-card.tsx
│   ├── channel-test-button.tsx
│   ├── add-channel-modal.tsx        # reuses ConnectionModal — ⊥ duplicate
│   ├── subscriptions-matrix.tsx     # connection × category grid
│   ├── matrix-row.tsx
│   ├── matrix-cell.tsx              # toggle, disabled-when-RBAC-blocks
│   ├── settings-skeleton.tsx
│   ├── use-channels.ts use-plugins.ts use-categories.ts use-subscriptions.ts
│   ├── use-toggle-subscription.ts use-test-channel.ts
│   ├── __tests__/
│   └── index.ts
├── admin/
│   ├── deliveries-page.tsx
│   ├── deliveries-table.tsx          # virtualised; suspense-infinite
│   ├── deliveries-filter-bar.tsx     # status × category × severity × user × date
│   ├── delivery-detail-dialog.tsx    # event payload, error, retry button
│   ├── delivery-row.tsx
│   ├── delivery-status-badge.tsx
│   ├── retention-settings-page.tsx   # /admin/settings/notifications
│   ├── retention-form.tsx
│   ├── use-admin-deliveries.ts use-admin-delivery.ts
│   ├── use-retry-delivery.ts use-admin-settings.ts
│   ├── __tests__/
│   └── index.ts
└── (note) ∀ existing app/notification-*.tsx files → moved into bell/ dir & renamed
```

Migration of existing code:

| Existing                                       | Target                                                                  |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| `app/notification-panel.tsx`                   | `features/notifications/bell/notification-bell.tsx`                     |
| `app/notification-panel-body.tsx`              | `features/notifications/bell/bell-popover-shell.tsx` (refactored)       |
| `app/notification-item.tsx`                    | `features/notifications/bell/popover-row.tsx` (renamed for scope)       |
| `app/notification-empty-state.tsx`             | `features/notifications/bell/popover-empty.tsx`                         |
| `app/notification-category-chip.tsx`           | `features/notifications/shared/category-chip.tsx` (cross-surface)       |
| `app/notification-severity-icon.tsx`           | `features/notifications/shared/severity-icon.tsx` (cross-surface)       |
| `app/notification-panel-types.ts`              | `features/notifications/shared/types.ts` (CATEGORY_META, SEVERITY_META) |
| `app/notification-panel-fixtures.ts`           | DELETED. Real API end-to-end.                                           |
| `app/top-nav.tsx` → `import NotificationPanel` | `import { NotificationBell } from "@/features/notifications"`           |

Co-tenancy: `inbox-row.tsx` & `popover-row.tsx` share `shared/notification-card-base.tsx` to ⊥ duplicate severity icon + admin-badge + relative-time layout. Compact (popover) vs comfortable (inbox page) variants via `density` prop.

> **Deferred.** `notification-card-base.tsx` and the `density` prop did not ship with the initial PR. `inbox-row.tsx` and `popover-row.tsx` remain standalone for v1. Revisit once a third row variant is needed.

## Data layer

### Query keys

`features/notifications/shared/query-keys.ts`:

```ts
export const notificationsKeys = {
  all: ["notifications"] as const,
  unreadCount: () => [...notificationsKeys.all, "unread-count"] as const,
  inbox: (filters: InboxFilters) => [...notificationsKeys.all, "inbox", filters] as const,
  inboxAll: () => [...notificationsKeys.all, "inbox"] as const,
  channels: () => [...notificationsKeys.all, "channels"] as const,
  plugins: () => [...notificationsKeys.all, "plugins"] as const,
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

`InboxFilters = { unreadOnly?: boolean; category?: NotificationCategory; severity?: NotificationSeverity }`. Stable JSON-serialisable shape ⇒ TanStack Query can hash → cache.

### Fetchers

`shared/fetchers.ts` wraps `api.notifications.*` Hono RPC endpoints. ∀ fetcher:

1. Calls Hono client.
2. Throws on `!res.ok` w/ normalised `NotificationsApiError` carrying `status` + parsed body.
3. Returns inferred response type from Hono RPC (zero hand-typed DTO).

Example:

```ts
export async function fetchInboxPage(
  filters: InboxFilters,
  cursor: string | null,
): Promise<InboxPage> {
  const res = await api.notifications.inbox.$get({
    query: {
      unreadOnly: filters.unreadOnly ? "1" : undefined,
      category: filters.category,
      severity: filters.severity,
      cursor: cursor ?? undefined,
      limit: "50",
    },
  });
  if (!res.ok) throw new NotificationsApiError(res.status, await safeJson(res));
  return res.json();
}
```

### Hooks

| Hook                                                          | Surface      | Type                               | Notes                                                                                                                                               |
| ------------------------------------------------------------- | ------------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useUnreadCount()`                                            | bell         | `useQuery`                         | `refetchInterval: 30_000`, `refetchIntervalInBackground: false`, `networkMode: "online"`, `staleTime: 15_000`. ⊥ suspense — ⊥-block top-nav render. |
| `usePopoverInbox()`                                           | bell         | `useSuspenseQuery`                 | First page only. Suspense boundary lives inside `BellPopoverShell` so header chrome renders before the inbox resolves; Popover/Drawer unmount handles the `enabled: open` semantics by tearing down the subtree. |
| `useInbox(filters)`                                           | inbox page   | `useSuspenseInfiniteQuery`         | `getNextPageParam: p => p.nextCursor`. Loader prefetches first page.                                                                                |
| `useMarkRead`/`useMarkUnread`/`useDismiss`/`useMarkAllRead`   | inbox + bell | `useMutation` + `useOptimistic`    | Invalidate `inboxAll()` + `unreadCount()` on settle.                                                                                                |
| `usePlugins`/`useChannels`/`useCategories`/`useSubscriptions` | settings     | `useSuspenseQuery`                 | All 4 prefetched in parallel by route loader.                                                                                                       |
| `useToggleSubscription()`                                     | settings     | `useMutation` + `useOptimistic`    | Optimistic flip of matrix cell; invalidate `subscriptions()` on settle.                                                                             |
| `useTestChannel()`                                            | settings     | `useMutation`                      | Per-card local state; ⊥ cache.                                                                                                                      |
| `useAdminDeliveries(f)`                                       | admin        | `useSuspenseInfiniteQuery`         | Cursor pagination identical to inbox.                                                                                                               |
| `useAdminDelivery(id)`                                        | admin        | `useSuspenseQuery`                 | For detail dialog; nested suspense.                                                                                                                 |
| `useRetryDelivery()`                                          | admin        | `useMutation`                      | Invalidate `deliveriesAll()` on success. 409 → toast "in flight".                                                                                   |
| `useAdminSettings()`/`useUpdateAdminSettings()`               | admin        | `useSuspenseQuery` + `useMutation` | Mutation seeds cache w/ returned clamped values (server returns persisted shape).                                                                   |

### Optimistic mark-read / dismiss

```ts
function useInboxMutations(filters: InboxFilters) {
  const qc = useQueryClient();
  const [optimisticActions, dispatch] = useOptimistic<
    { ids: ReadonlySet<string>; readAt: number | null }[],
    InboxAction
  >([], reducer);

  const markRead = useMutation({
    mutationFn: (ids: string[]) => fetchMarkRead(ids),
    onMutate: (ids) => dispatch({ kind: "markRead", ids }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: notificationsKeys.inboxAll() });
      void qc.invalidateQueries({ queryKey: notificationsKeys.unreadCount() });
    },
  });
  // …
}
```

`InboxRow` consumes `optimisticActions` to flip `readAt` immediately. React 19 rolls back state on throw; mutation `onSettled` re-fetches authoritative state.

### Loader prefetch (TanStack Router)

Requires router context wiring — micro-change to `apps/client/src/main.tsx`:

```ts
const queryClient = new QueryClient();
const router = createRouter({ routeTree, context: { queryClient } });
```

Plus root route declares `context<{ queryClient: QueryClient }>()`. Existing routes ⊥ touch context ⇒ ⊥ break.

Per-route loader pattern:

```ts
export const Route = createFileRoute("/_authenticated/_app/notifications")({
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureInfiniteQueryData({
      queryKey: notificationsKeys.inbox({}),
      queryFn: ({ pageParam }) => fetchInboxPage({}, pageParam),
      initialPageParam: null,
    }),
  pendingComponent: InboxPageSkeleton,
  errorComponent: NotificationsErrorBoundary,
  component: InboxPage,
});
```

Settings page parallel-prefetches 4 queries:

```ts
loader: ({ context: { queryClient } }) =>
  Promise.all([
    queryClient.ensureQueryData({ queryKey: notificationsKeys.plugins(), queryFn: fetchPlugins }),
    queryClient.ensureQueryData({ queryKey: notificationsKeys.channels(), queryFn: fetchChannels }),
    queryClient.ensureQueryData({
      queryKey: notificationsKeys.categories(),
      queryFn: fetchCategories,
    }),
    queryClient.ensureQueryData({
      queryKey: notificationsKeys.subscriptions(),
      queryFn: fetchSubscriptions,
    }),
  ]);
```

## Surface specs

### 1. Bell (top nav)

Existing popover/drawer scaffold preserved; data swap + decomposition.

**Render-first chrome.** `<NotificationBell />` mounts immediately; bell shell + dot dot-only after `useUnreadCount` resolves. ⊥ block top-nav. Polling: 30s foreground, paused background. Network offline ⇒ ⊥ poll, last cached count shown.

**Popover open behaviour:**

- Mount popover → fire `usePopoverInbox` (first page, 25 items) inside `<Suspense fallback={<PopoverSkeleton/>}>`.
- Filter chip + unread toggle wrap in `useTransition` ⇒ filter flip ⊥ block typing-adjacent UI.
- Hover/focus → `useMarkRead([item.id])` (existing behaviour preserved). Optimistic.
- Dismiss button → `useDismiss` (server `DELETE /inbox` w/ single id).
- Mark-all-read button → `useMarkAllRead({ category? })` w/ active filter.
- Settings button → `<Link to="/settings/notifications">`.
- View-all button → `<Link to="/notifications">`.

**Mobile drawer parity:** same body via `<BellPopoverShell mobile />`. Existing `useIsMobile` flow unchanged.

### 2. `/notifications` inbox page

Route: `/_authenticated/_app/notifications.tsx`.

Layout (desktop):

```
┌──────────────────────────────────────────────────────────┐
│ Notifications                              [⚙ Settings]  │
│ {n} unread · [All ▾] [Unread] [Category × Severity]      │
│ [Mark all read] [Delete read]                            │
├──────────────────────────────────────────────────────────┤
│ ░░░░ severity-icon │ Title             {ago} ●          │
│                    │ Body markdown                        │
│                    │ [Action] [Secondary]    media · admin│
├──────────────────────────────────────────────────────────┤
│ … virtualised list, infinite scroll                      │
└──────────────────────────────────────────────────────────┘
```

Filter panel = `<InboxToolbar />`. Filter changes wrapped in `startTransition` so list ⊥ pop. Empty state per filter.

Bulk actions bar: appears when ≥1 row selected via checkbox column. Calls `mark-read` | `mark-unread` | `delete` w/ `ids[]`.

Virtualisation: `@tanstack/react-virtual` (already present? check pre-PR; if absent, add as catalog dep — minor, single PR justified). Renders ~30 visible rows of 200-cap inbox window.

Active filters survive route remount via search-param sync (`useSearch` from TanStack Router) — `useSearch` ⇒ filter object ⇒ `notificationsKeys.inbox(filters)` cache key. Shareable URL.

### 3. `/settings/notifications`

Route: `/_authenticated/_settings/settings/notifications.tsx`.

```
┌─ Channels ──────────────────────────────────────────────┐
│ + Add channel                                            │
│ ┌ ntfy "Phone" · v0.1.0  [Test] [Edit] [Delete]          │
│ │ Topic: phone-alerts · Server: ntfy.sh                  │
│ └────                                                    │
│ ┌ Inbox (built-in)        [—]                            │
│ └ Always on, can't be removed                            │
└──────────────────────────────────────────────────────────┘

┌─ Subscriptions ─────────────────────────────────────────┐
│              | Media | Sync | Auth | System             │
│ Phone (ntfy) |  ☑   |  ☑   |  ☐   |  —                  │
│ Inbox        |  ☑   |  ☑   |  ☑   |  ☑                  │
│ ─ disabled cells: missing RBAC permission                │
└──────────────────────────────────────────────────────────┘
```

**Channels section** = list of `notification-capable` connections (subset of all user connections). Powered by `GET /api/notifications/channels`. Add-channel → opens `<ConnectionModal>` filtered to plugins from `GET /api/notifications/plugins`. Reuse existing `ConnectionModal` w/ injected `availablePlugins` prop ⊥ writing new modal. Edit/Delete/Test = existing connection routes.

**Subscriptions matrix.** One row per channel (connection), one column per category (4: media/sync/auth/system). Cell = checkbox. Categories user lacks RBAC permission for = disabled cell + tooltip explaining (`allowed: false` from `/categories`). Toggle → `useToggleSubscription({connectionId, category, enabled})` w/ optimistic flip. `PUT /api/notifications/subscriptions/:c/:cat` per cell; bulk-save button optional v1 (cells auto-persist).

Inbox-channel row: inbox category mask = ∀ allowed categories. Cannot delete; "Always on" badge.

Test button per channel → `POST /api/notifications/channels/:id/test` → toast w/ `{ok, message}`.

### 4. `/admin/notifications/deliveries`

Route: `/_authenticated/_settings/admin/notifications/deliveries.tsx`. Permission: `ADMIN_SERVER` (gated by `_settings/admin` layout per existing `admin/users.tsx` pattern).

```
┌ Deliveries ─────────────────────────────────────────────┐
│ [Status ▾][Category ▾][Severity ▾][User…][From][To]     │
├──────────────────────────────────────────────────────────┤
│ time      event_type            user        plugin  st  │
│ 04:21:09  media.request.avail   alice       ntfy    ✔   │
│ 04:20:55  job.run.failed        admin       inbox   ✔   │
│ 04:18:01  connection.auth.exp   bob         ntfy    ⚠ 4 │
│ …virtualised, infinite scroll                            │
└──────────────────────────────────────────────────────────┘

Click row → <DeliveryDetailDialog>
  ┌ event payload ─ JSON ─ syntax highlighted              │
  │ attempts: -                                             │
  │ last_error: …                                            │
  │ [Retry] (409 → toast "delivery in flight, try later")   │
  └─────────────────────────────────────────────────────────┘
```

Filter bar inputs: status select, category select, severity select, user-id text input (debounced via `useDeferredValue`), date pickers (from/to). State ⇒ `notificationsKeys.admin.deliveries(filters)` cache key.

Detail dialog uses nested `useSuspenseQuery(useAdminDelivery(id))` — opens immediately w/ skeleton; payload streams in. Payload renders w/ `react-json-view`-equivalent (light-weight inline component, ⊥ new dep — small custom JSON tree component).

Retry button calls `POST /api/admin/notifications/deliveries/:id/retry`. On 409 → toast `notifications.delivery_in_progress`. On 200 → toast "Retry queued" + `invalidateQueries(deliveriesAll())`.

### 5. `/admin/settings/notifications`

Route: `/_authenticated/_settings/admin/settings/notifications.tsx` (or `/admin/notifications/settings.tsx` — match neighbouring admin pages, defer to existing convention).

Form: `<RetentionForm>` w/ 2 numeric inputs:

- Inbox retention (days)
- Delivery retention (days)

Bound to `GET/PATCH /api/admin/notifications/settings`. Server returns clamped persisted values; client seeds cache w/ response so UI reflects clamping w/o follow-up GET.

Save = `useUpdateAdminSettings` mutation. Toast on success/failure. ⊥ optimistic — settings affect future cleanup jobs, ⊥ instant feedback need.

## i18n

Existing keys in `apps/client/messages/notifications/en.json` cover popover. Add ∀ surface:

- `notifications_page_title` "Notifications"
- `notifications_page_subtitle_unread` "{count} unread"
- `notifications_filter_severity_*`
- `notifications_bulk_select_aria` `notifications_bulk_delete` `notifications_bulk_mark_read`
- `notifications_settings_channels_title` `notifications_settings_subscriptions_title`
- `notifications_settings_add_channel` `notifications_settings_test_button`
- `notifications_settings_test_ok_toast` `notifications_settings_test_fail_toast`
- `notifications_settings_inbox_locked` ("Always on")
- `notifications_settings_category_locked` ("Requires {permission} role")
- `notifications_admin_deliveries_title` + filter labels + status labels
- `notifications_admin_retry_in_flight` `notifications_admin_retry_queued`
- `notifications_admin_settings_title` `notifications_admin_settings_inbox_retention` `notifications_admin_settings_delivery_retention` `notifications_admin_settings_save`

Mirror to `fa.json` w/ Persian copy. ∀ message keys snake_case, top-level scalar | declarative format already in file.

## Tests

Vitest + Testing Library. 1 file per concern. ∀ tests render w/ `<QueryClientProvider>` + `<MemoryHistory>` adapters per existing test helpers (see `features/settings/__tests__/`).

Coverage:

- `bell/__tests__/`
  - unread count badge state w/ poll interval mocked.
  - popover open ⇒ list renders ⇒ click row triggers mark-read mutation.
  - offline state ⇒ ⊥ poll, last value persists.
- `inbox/__tests__/`
  - infinite scroll loads next page from cursor.
  - filter chip swap inside `useTransition` ⊥ teardown list mid-update.
  - mark-read → row strikes through immediately, mutation called once.
  - mark-all-read scoped to active category filter.
  - delete row → vanishes from list, count decrements.
- `settings/__tests__/`
  - channel test button → renders ok|fail toast.
  - matrix toggle → optimistic flip, mutation invoked, RBAC-blocked cells disabled.
  - add-channel modal opens w/ `notificationDelivery`-capable plugin list only.
- `admin/__tests__/`
  - filter bar → URL search params updated, query key changes ⇒ refetch.
  - deferred user-id filter ⊥ refetch on every keystroke.
  - retry 409 → toast "in flight"; retry 200 → invalidates list.
  - retention form: server clamp reflected in inputs after save.
- `shared/__tests__/`
  - `notificationsKeys` factory: stable hashes ∀ filter shapes.
  - `fetchers` error normalisation: 4xx | 5xx ⇒ `NotificationsApiError`.
  - error boundary reset clears query cache for tree.

CI: `vp test` covers ∀; `vp check` for type + lint.

## Observability

`reportError(err, "warning", { surface })` calls inside fetcher catch + mutation `onError`. Existing `instrumentedFetch` already stamps request-id ⇒ delivery-detail dialog can surface request-id w/ "Copy" button when delivery has `last_error_code`.

⊥ new metrics. Server already emits per `docs/2026-04-25-notifications-design.md §Metrics`.

## Flag flip

Same PR adds:

```ts
// apps/server/src/config.ts (or env loader)
NOTIFICATIONS_ENABLED: z.coerce.boolean().default(true), // was false
```

Or removes the gate entirely if all gating call-sites are server-internal — verify w/ `grep "NOTIFICATIONS_ENABLED" apps/server/`. Drop the env flag iff all server tests pass w/o it; otherwise flip default & remove next release.

⊥ data backfill needed beyond what PR 4 already shipped (built-in inbox connection per user).

## Phasing inside the PR

Single PR. Internal commit sequence (small focused commits per CLAUDE.md):

1. Move `app/notification-*.tsx` → `features/notifications/bell/` + `shared/`. Pure rename + 1 import update in `top-nav.tsx`. ⊥ behaviour change — fixtures stay.
2. Add `features/notifications/shared/{query-keys,fetchers,types,error-boundary}.ts`.
3. Wire router `context: { queryClient }` in `main.tsx`.
4. Bell: replace fixtures w/ `useUnreadCount` + `usePopoverInbox`; add `useInboxMutations`. Remove `notification-panel-fixtures.ts`.
5. Build inbox page route + `useInbox` + virtualised list + bulk actions.
6. Build settings route + channels list (reuse `ConnectionModal`) + subscription matrix.
7. Build admin deliveries page + detail dialog + retry.
8. Build retention settings form.
9. i18n keys for `en` + `fa`.
10. Tests per surface (1 file each per `__tests__/` dir).
11. Flag flip.
12. Changeset (`@ent-mcp/client: minor`) — copy from server design's PR-8 line.

Each commit independently green under `vp check && vp test`.

## Risks & open questions

- **Router context migration.** `createRouter({ context })` requires every route to declare `context<...>()` if currently typed-strict. Verify by running `vp check` after step 3. If breaking, add `// eslint-disable-next-line` waiver only to prove compile, file follow-up issue. ⊥ block.
- **`@tanstack/react-virtual` dep add.** Adds ~12 KB gzipped. Acceptable v1 — alt = render full 200 inbox cap unvirtualised (acceptable degenerate case but admin deliveries can have 1000s, virtualise mandatory there). Decide once: add lib, use ∀ surfaces.
- **`NOTIFICATIONS_ENABLED` lifecycle.** Server `private: false` plugins (`@ent-mcp/plugin-{ntfy,telegram,discord}`) shipped in PR 7 already — no flag-relevant changeset. Client release line acknowledges first user-visible.
- **Reusing `ConnectionModal`.** Modal takes `plugin: PluginSummary | null`. Settings/notifications drives it off `GET /api/notifications/plugins` directly — that endpoint now returns the full `PluginSummary` shape plus `supportsKinds`, so the page hands an entry straight to the modal without a second `/connections/available` round-trip. `/connections/available` excludes notification-only plugins (sole user-scoped cap = `notificationDelivery`) so the two sections own disjoint plugin sets; plugins that mix `notificationDelivery` with another user-scoped capability appear in both. ⊥ breaking.
- **Mobile admin deliveries.** Filter bar dense; scope to ≥md viewport. Mobile = stacked select column; defer ergonomic polish.
- **Existing notification panel test coverage.** None today (panel was fixture-only). New tests = first-real notification client tests. Watch for `Suspense`-aware test render adapter; reuse from `features/settings/__tests__/`.

## Out of v1 (deferred, ⊥ lost)

- Real-time push (SSE/WebSocket).
- Per-event subscription overrides UI.
- Snooze, quiet hours, scheduled delivery UI.
- Plugin-author UX for new `notificationDelivery` plugins past minimal config form (already covered by `SchemaForm`).
- Bulk-save in subscription matrix (`POST /subscriptions/bulk`) — defer until cell-by-cell UX shows friction; route exists.
- Export deliveries CSV from admin.
- Client-side delivery analytics dashboard. Server metrics ∃; surface deferred.

---

## Settings inbox row (2026-05-10)

`/settings/notifications` channels list renders a locked first row labelled **Inbox**. Behaviour:

- Always on, all categories enabled. ⊥ user-toggleable.
- Virtual — ⊥ row in `service_connections`, ⊥ row in subscription table. Rendered statically client-side at top of channels list.
- ⊥ delete, ⊥ test, ⊥ edit. Locked badge.
- Categories grid disabled w/ pressed state ∀ category (visual = "delivers everything").

Rationale: in-app inbox = the universal sink. Every `notifications.emit()` lands there regardless of subscriptions (per server design). Surface as locked row instead of fake subscription rows so settings tab honestly reflects: "you can't opt out of in-app".

Wire change: `channels-section.tsx` prepends a literal `<InboxRow />` ahead of mapped `channels`. ⊥ data dependency. Client-only constant.
