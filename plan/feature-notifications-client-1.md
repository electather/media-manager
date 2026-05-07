---
goal: Wire notifications client UI ⇒ live API across 5 surfaces, single PR, flag-flip same merge
version: 1.0
date_created: 2026-05-06
last_updated: 2026-05-06
owner: Omid Astaraki
status: "Planned"
tags: [feature, frontend, notifications, client, react-19, tanstack-query]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Implement client UI for notifications service across 5 surfaces — top-bar bell + popover, `/notifications` inbox, `/settings/notifications`, `/admin/notifications/deliveries`, `/admin/settings/notifications` — wire to existing `/api/notifications/*` & `/api/admin/notifications/*` endpoints. Replace fixture data in existing bell scaffold w/ live data. Flip `NOTIFICATIONS_ENABLED=true` same PR.

Stack: React 19 concurrent (`useSuspenseQuery`, `useOptimistic`, `useTransition`, `useDeferredValue`) + TanStack Router 1.169 loaders + TanStack Query 5.100 + Hono RPC.

Spec: `docs/2026-05-06-notifications-client-design.md`
Server design: `docs/2026-04-25-notifications-design.md` (PRs 1–7 shipped, gated by `NOTIFICATIONS_ENABLED`)

---

## 1. Requirements & Constraints

- **REQ-001**: Single PR delivers ∀ 5 surfaces + flag flip. ⊥ phase split.
- **REQ-002**: ∀ data hooks centralised under `apps/client/src/features/notifications/`. Sibling features ⊥ import internals.
- **REQ-003**: Existing `app/notification-*.tsx` files moved into `features/notifications/bell/` & `shared/`. Fixtures (`DUMMY_NOTIFICATIONS`) deleted.
- **REQ-004**: Bell + popover ⊥ block top-nav render. `useUnreadCount` plain `useQuery`, ⊥ suspense, `refetchInterval: 30_000`, `refetchIntervalInBackground: false`, `networkMode: "online"`.
- **REQ-005**: Dedicated routes (`/notifications`, `/settings/notifications`, `/admin/notifications/deliveries`, `/admin/settings/notifications`) use `loader: ({ context: { queryClient } }) => queryClient.ensureQueryData(...)` + `useSuspenseQuery` | `useSuspenseInfiniteQuery` inside.
- **REQ-006**: `<Suspense>` + `<ErrorBoundary>` per route. Reset-on-retry via `queryClient.resetQueries`.
- **REQ-007**: Mark-read | dismiss | mark-all-read = `useMutation` + React 19 `useOptimistic`. Server-driven rollback on error.
- **REQ-008**: Filter swaps wrapped in `useTransition`. Admin search debounced via `useDeferredValue`.
- **REQ-009**: Cursor pagination via `useSuspenseInfiniteQuery`, `getNextPageParam: p => p.nextCursor`. Cursor opaque to client.
- **REQ-010**: Inbox + deliveries lists virtualised via `@tanstack/react-virtual`. Add as catalog dep.
- **REQ-011**: Add-channel modal reuses existing `ConnectionModal` w/ injected plugin list filtered to `notificationDelivery@v1`-capable plugins.
- **REQ-012**: Subscription matrix cells locked + tooltip-explained when `categories[i].allowed === false`.
- **REQ-013**: i18n keys added to `apps/client/messages/notifications/{en,fa}.json`. ⊥ hard-coded copy in components.
- **REQ-014**: `NOTIFICATIONS_ENABLED` flag default → `true` (or removed if no remaining gates) same PR.
- **REQ-015**: Changeset 1-2 non-technical sentences (memory rule #11). Bump = minor.
- **CON-001**: ⊥ new top-level deps past `@tanstack/react-virtual`.
- **CON-002**: ⊥ flat files >250 LOC. Decompose per memory rule #17.
- **CON-003**: TanStack Router context micro-change in `apps/client/src/main.tsx` (`createRouter({ routeTree, context: { queryClient } })`). Root route declares `context<{ queryClient }>()`.
- **CON-004**: ∀ fetchers wrap Hono RPC; ⊥ hand-typed DTO. Response types inferred from `AppType`.
- **CON-005**: Mutation `onSettled` invalidates ∀ relevant query keys via `notificationsKeys` factory.
- **CON-006**: Search-param sync (TanStack Router `useSearch`) drives filters on `/notifications` & `/admin/notifications/deliveries` so URLs shareable.
- **CON-007**: `vp check && vp test` green per commit.
- **GUD-001**: One file per concern. Sub-component dir per surface.
- **GUD-002**: Reuse `shared/components/error-boundary.tsx`, `shared/lib/errors/report.ts`, `shared/components/schema-form` where applicable.
- **GUD-003**: Toast feedback via existing `sonner` `Toaster`. ⊥ new toast lib.
- **PAT-001**: Co-locate hooks w/ surface that owns primary read.
- **PAT-002**: ∀ feature exports = `features/notifications/index.ts` barrel. Outside imports = `@/features/notifications` only.
- **PAT-003**: Test files in per-surface `__tests__/` dirs. Render adapters reuse existing `features/settings/__tests__/` scaffolding.

## 2. Implementation Steps

### Implementation Phase 1 — Move existing chrome to feature dir

- GOAL-001: Relocate fixture-driven bell scaffold into `features/notifications/{bell,shared}/`. Pure rename; ⊥ behaviour change. Fixtures still drive panel; flag still off. `vp check && vp test` green.

| Task     | Description                                                                                                                                                                                                                                        | Completed | Date |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-001 | Create `apps/client/src/features/notifications/` w/ subdirs `bell/`, `shared/`, `inbox/`, `settings/`, `admin/`. Add empty `index.ts` per subdir + top-level `index.ts`.                                                                           |           |      |
| TASK-002 | Move `app/notification-panel.tsx` → `features/notifications/bell/notification-bell.tsx`. Rename `NotificationPanel` → `NotificationBell`. Update `bellAriaLabel` export path.                                                                      |           |      |
| TASK-003 | Move `app/notification-panel-body.tsx` → `features/notifications/bell/bell-popover-shell.tsx`. Rename component `NotificationPanelBody` → `BellPopoverShell`.                                                                                      |           |      |
| TASK-004 | Move `app/notification-item.tsx` → `features/notifications/bell/popover-row.tsx`. Rename `NotificationItem` → `PopoverRow`.                                                                                                                        |           |      |
| TASK-005 | Move `app/notification-empty-state.tsx` → `features/notifications/bell/popover-empty.tsx`. Rename `NotificationEmptyState` → `PopoverEmpty`.                                                                                                       |           |      |
| TASK-006 | Move `app/notification-category-chip.tsx` → `features/notifications/shared/category-chip.tsx`. Cross-surface use.                                                                                                                                  |           |      |
| TASK-007 | Move `app/notification-severity-icon.tsx` → `features/notifications/shared/severity-icon.tsx`. Cross-surface use.                                                                                                                                  |           |      |
| TASK-008 | Move `app/notification-panel-types.ts` → `features/notifications/shared/types.ts`. Keep `CATEGORY_META`, `SEVERITY_META`, `categoryLabel`, `Density`, `Intensity`. Re-export `NotificationItemDto` for now (becomes server-shaped DTO in Phase 4). |           |      |
| TASK-009 | Move `app/notification-panel-fixtures.ts` → `features/notifications/bell/__fixtures__/popover-fixtures.ts`. Will delete in Phase 4. Keep import working from `notification-bell.tsx` so behaviour ⊥ change.                                        |           |      |
| TASK-010 | Update `apps/client/src/app/top-nav.tsx`: `import { NotificationPanel } from "./notification-panel"` → `import { NotificationBell } from "@/features/notifications"`. JSX `<NotificationPanel />` → `<NotificationBell />`.                        |           |      |
| TASK-011 | Populate `features/notifications/index.ts` w/ `export { NotificationBell } from "./bell"`. Populate `bell/index.ts` w/ `export { NotificationBell } from "./notification-bell"`.                                                                   |           |      |
| TASK-012 | Add fallow zone entry: `.fallowrc.json` add `client-feat-notifications` zone w/ pattern `apps/client/src/features/notifications/**`.                                                                                                               |           |      |
| TASK-013 | Run `vp check && vp test`. Confirm fixture popover still renders identically to pre-move state. Commit: "refactor(client): move notification chrome into features/notifications".                                                                  |           |      |

### Implementation Phase 2 — Data layer foundation

- GOAL-002: Add query-key factory, fetchers, error class, types, error boundary. Wire router context. Lay foundation w/ ⊥ visible UI change.

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-014 | Create `features/notifications/shared/query-keys.ts` exporting `notificationsKeys` factory per design §Data layer. Branches: `all`, `unreadCount`, `inbox(filters)`, `inboxAll`, `channels`, `plugins`, `categories`, `subscriptions`, `admin.{deliveries(filters), deliveriesAll, delivery(id), settings}`.                                                                                                                                                                                                                                |           |      |
| TASK-015 | Create `features/notifications/shared/types.ts` (extend existing). Add `InboxFilters`, `AdminDeliveryFilters`, `NotificationsApiError` class extending `Error` w/ `status` + parsed body fields.                                                                                                                                                                                                                                                                                                                                            |           |      |
| TASK-016 | Create `features/notifications/shared/fetchers.ts`. ∀ fetcher wraps `api.notifications.*` Hono RPC, throws `NotificationsApiError` on `!res.ok`. Functions: `fetchInboxPage`, `fetchUnreadCount`, `fetchPlugins`, `fetchChannels`, `fetchCategories`, `fetchSubscriptions`, `fetchAdminDeliveriesPage`, `fetchAdminDelivery`, `fetchAdminSettings`. Plus mutators: `fetchMarkRead`, `fetchMarkUnread`, `fetchDismiss`, `fetchMarkAllRead`, `fetchToggleSubscription`, `fetchTestChannel`, `fetchRetryDelivery`, `fetchUpdateAdminSettings`. |           |      |
| TASK-017 | Create `features/notifications/shared/error-boundary.tsx`: React error boundary that catches `NotificationsApiError` + suspense fallback errors. Render fallback w/ retry button calling `queryClient.resetQueries({ queryKey: notificationsKeys.all })`.                                                                                                                                                                                                                                                                                   |           |      |
| TASK-018 | Modify `apps/client/src/main.tsx`: change `createRouter({ routeTree })` → `createRouter({ routeTree, context: { queryClient } })`. Add `Register` interface change if needed.                                                                                                                                                                                                                                                                                                                                                               |           |      |
| TASK-019 | Modify `apps/client/src/routes/__root.tsx` (read first): declare `createRootRouteWithContext<{ queryClient: QueryClient }>()` in place of `createRootRoute()`. ⊥ break existing routes — context optional inside leaves.                                                                                                                                                                                                                                                                                                                    |           |      |
| TASK-020 | Run `vp check && vp test`. Commit: "feat(client): add notifications data layer scaffolding".                                                                                                                                                                                                                                                                                                                                                                                                                                                |           |      |

### Implementation Phase 3 — Bell + popover live data

- GOAL-003: Replace fixtures w/ real API. Render-first chrome, suspended popover content, optimistic mark-read.

| Task     | Description                                                                                                                                                                                                                                                                             | Completed | Date |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-021 | Create `features/notifications/bell/use-unread-count.ts`. `useQuery({ queryKey: notificationsKeys.unreadCount(), queryFn: fetchUnreadCount, refetchInterval: 30_000, refetchIntervalInBackground: false, networkMode: "online", staleTime: 15_000 })`.                                  |           |      |
| TASK-022 | Create `features/notifications/bell/use-popover-inbox.ts`. `useQuery({ enabled: open, queryKey: notificationsKeys.inbox({}), queryFn: () => fetchInboxPage({}, null), staleTime: 30_000 })`. Returns first 25 items only.                                                               |           |      |
| TASK-023 | Create `features/notifications/inbox/use-inbox-mutations.ts` (used by bell + inbox page). Hooks: `useMarkRead`, `useMarkUnread`, `useDismiss`, `useMarkAllRead`. ∀ mutation `onSettled` invalidates `inboxAll()` + `unreadCount()`. Optimistic state via `useOptimistic` from React 19. |           |      |
| TASK-024 | Refactor `features/notifications/bell/notification-bell.tsx`: replace `useState<NotificationItemDto[]>(DUMMY_NOTIFICATIONS)` w/ `useUnreadCount`. Bell chrome renders immediately; dot rendered conditionally on count.                                                                 |           |      |
| TASK-025 | Refactor `features/notifications/bell/bell-popover-shell.tsx`: source `items` from `usePopoverInbox` inside `<Suspense fallback={<PopoverSkeleton/>}>`. Wrap filter swap in `startTransition`.                                                                                          |           |      |
| TASK-026 | Refactor `features/notifications/bell/popover-row.tsx`: source mutations from `useInboxMutations`. `onMouseEnter`/`onFocus` → `markRead([item.id])` w/ optimistic flip preserved.                                                                                                       |           |      |
| TASK-027 | Add `features/notifications/bell/popover-skeleton.tsx`. Suspense fallback for popover content. Show 3 skeleton rows.                                                                                                                                                                    |           |      |
| TASK-028 | Wire popover footer: "Settings" → `<Link to="/settings/notifications">`, "View all" → `<Link to="/notifications">`. Routes ⊥ exist yet — TanStack Router will throw at runtime; placeholder routes added in Phase 4.                                                                    |           |      |
| TASK-029 | Delete `features/notifications/bell/__fixtures__/popover-fixtures.ts` + import in `notification-bell.tsx`.                                                                                                                                                                              |           |      |
| TASK-030 | Add tests `features/notifications/bell/__tests__/notification-bell.test.tsx`: unread badge state, polling interval, offline behaviour. Reuse `<QueryClientProvider>` adapter from `features/settings/__tests__/security.test.tsx`.                                                      |           |      |
| TASK-031 | Run `vp check && vp test`. Commit: "feat(client): wire notifications bell to live API".                                                                                                                                                                                                 |           |      |

### Implementation Phase 4 — `/notifications` inbox page

- GOAL-004: Build full inbox route w/ filters, virtualised list, infinite scroll, bulk actions.

| Task     | Description                                                                                                                                                                                                                                                                               | Completed | Date |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-032 | Add `@tanstack/react-virtual` to `apps/client/package.json` via `vp add @tanstack/react-virtual`. Lockfile commit.                                                                                                                                                                        |           |      |
| TASK-033 | Create `features/notifications/inbox/use-inbox.ts`. `useSuspenseInfiniteQuery({ queryKey: notificationsKeys.inbox(filters), queryFn: ({ pageParam }) => fetchInboxPage(filters, pageParam), initialPageParam: null, getNextPageParam: p => p.nextCursor })`.                              |           |      |
| TASK-034 | Create `features/notifications/inbox/inbox-toolbar.tsx`: filter chips (category, severity), unread toggle, "Mark all read" button (calls `useMarkAllRead({ category })`), "Delete read" (calls `DELETE /inbox/all` w/ `{ readOnly: true }`). Filter changes wrapped in `startTransition`. |           |      |
| TASK-035 | Create `features/notifications/inbox/inbox-list.tsx`: virtualises rows w/ `@tanstack/react-virtual`. Uses `useInbox(filters)`. Auto-fetch next page on scroll near bottom (sentinel-row pattern).                                                                                         |           |      |
| TASK-036 | Create `features/notifications/inbox/inbox-row.tsx`: comfortable-density row. Reads optimistic `readAt` from `useInboxMutations`. Checkbox column for bulk select.                                                                                                                        |           |      |
| TASK-037 | Create `features/notifications/inbox/inbox-empty.tsx`: empty state per filter (matches existing `popover-empty` content but full-page layout).                                                                                                                                            |           |      |
| TASK-038 | Create `features/notifications/inbox/inbox-skeleton.tsx`: route `pendingComponent` rendering page header + 8 skeleton rows.                                                                                                                                                               |           |      |
| TASK-039 | Create `features/notifications/inbox/inbox-bulk-bar.tsx`: appears when ≥1 row selected. "Mark read" `useMarkRead(ids)`, "Mark unread" `useMarkUnread(ids)`, "Delete" calls `DELETE /inbox` w/ `{ ids }`.                                                                                  |           |      |
| TASK-040 | Create `features/notifications/inbox/inbox-page.tsx`: top-level page. `<InboxToolbar />`, `<Suspense fallback={<InboxSkeleton />}><InboxList /></Suspense>`, `<InboxBulkBar />`.                                                                                                          |           |      |
| TASK-041 | Create route file `apps/client/src/routes/_authenticated/_app/notifications.tsx`: `Route = createFileRoute(...)({ validateSearch: zodInboxFilters, loader, pendingComponent: InboxPageSkeleton, errorComponent: NotificationsErrorBoundary, component: InboxPage })`.                     |           |      |
| TASK-042 | Add inbox bottom-nav entry. Modify `app/bottom-nav.tsx` + `app/nav-items.ts` to include Notifications tab (mobile). Link to `/notifications`.                                                                                                                                             |           |      |
| TASK-043 | Update `features/notifications/index.ts` to export inbox surface (just route component if needed; route file imports directly).                                                                                                                                                           |           |      |
| TASK-044 | Tests `features/notifications/inbox/__tests__/inbox-page.test.tsx`: infinite scroll loads next page, filter swap inside transition, mark-read optimistic, mark-all-read scoped to filter, bulk delete. Render adapter w/ TanStack Router memory history.                                  |           |      |
| TASK-045 | Run `vp check && vp test`. Commit: "feat(client): add /notifications inbox page".                                                                                                                                                                                                         |           |      |

### Implementation Phase 5 — `/settings/notifications`

- GOAL-005: Channels list w/ test buttons + add-channel modal reuse, subscriptions matrix w/ optimistic toggling.

| Task     | Description                                                                                                                                                                                                                                                                                 | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-046 | Create `features/notifications/settings/use-{channels,plugins,categories,subscriptions}.ts`. ∀ = `useSuspenseQuery` wrapping respective fetcher.                                                                                                                                            |           |      |
| TASK-047 | Create `features/notifications/settings/use-toggle-subscription.ts`. `useMutation` + `useOptimistic`. Body `{ connectionId, category, enabled }`. `onSettled` → invalidate `subscriptions()`.                                                                                               |           |      |
| TASK-048 | Create `features/notifications/settings/use-test-channel.ts`. `useMutation` calling `fetchTestChannel(connectionId)`. ⊥ cache; per-card local state via mutation `data` / `error`.                                                                                                          |           |      |
| TASK-049 | Create `features/notifications/settings/channel-card.tsx`: row per channel. Plugin name, display name, config summary (server-redacted). Buttons: Test, Edit (opens existing `ConnectionModal`), Delete (calls `DELETE /api/connections/:id`). Inbox channel: "Always on" badge, no delete. |           |      |
| TASK-050 | Create `features/notifications/settings/channel-test-button.tsx`: button + status indicator (idle/testing/ok/err). Uses `useTestChannel`.                                                                                                                                                   |           |      |
| TASK-051 | Create `features/notifications/settings/channels-section.tsx`: list of channel cards + "Add channel" button. Renders `usePlugins` filtered by `notificationDelivery@v1`.                                                                                                                    |           |      |
| TASK-052 | Create `features/notifications/settings/add-channel-modal.tsx`: wraps existing `ConnectionModal`. Pass plugin list filtered to notification-capable. After save → `invalidateQueries(notificationsKeys.channels())`.                                                                        |           |      |
| TASK-053 | Create `features/notifications/settings/matrix-cell.tsx`: checkbox cell. Disabled + tooltip when category `allowed: false`. Toggle calls `useToggleSubscription`.                                                                                                                           |           |      |
| TASK-054 | Create `features/notifications/settings/matrix-row.tsx`: one row per channel. Inbox row: ∀ cells force-on. Other channels: cells reflect `subscriptions` map.                                                                                                                               |           |      |
| TASK-055 | Create `features/notifications/settings/subscriptions-matrix.tsx`: header row of category names, body rows of channels. ARIA labelling per cell.                                                                                                                                            |           |      |
| TASK-056 | Create `features/notifications/settings/notifications-settings-page.tsx`: page top w/ `<ChannelsSection />` + `<SubscriptionsMatrix />`. `<Suspense>` boundary wrapping each section.                                                                                                       |           |      |
| TASK-057 | Create `features/notifications/settings/settings-skeleton.tsx`: route `pendingComponent` rendering 2 section skeletons.                                                                                                                                                                     |           |      |
| TASK-058 | Create route file `apps/client/src/routes/_authenticated/_settings/settings/notifications.tsx`. `loader` parallel-prefetches `plugins, channels, categories, subscriptions`.                                                                                                                |           |      |
| TASK-059 | Update `apps/client/src/app/settings-layout.tsx` (or `nav-items.ts` per current layout) to include Notifications link in settings sidebar.                                                                                                                                                  |           |      |
| TASK-060 | Tests `features/notifications/settings/__tests__/settings-page.test.tsx`: matrix toggle optimistic, RBAC-blocked cell disabled, channel test button outcomes, add-channel modal opens.                                                                                                      |           |      |
| TASK-061 | Run `vp check && vp test`. Commit: "feat(client): add /settings/notifications page".                                                                                                                                                                                                        |           |      |

### Implementation Phase 6 — `/admin/notifications/deliveries` + retry

- GOAL-006: Admin deliveries list w/ filters, detail dialog, retry, infinite scroll. RBAC-gated by existing admin layout.

| Task     | Description                                                                                                                                                                                                                                                                                       | Completed   | Date      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | --------- | ---------------------- | --- | --- |
| TASK-062 | Create `features/notifications/admin/use-admin-deliveries.ts`. `useSuspenseInfiniteQuery({ queryKey: notificationsKeys.admin.deliveries(filters), queryFn: ({ pageParam }) => fetchAdminDeliveriesPage(filters, pageParam), getNextPageParam: p => p.nextCursor })`.                              |             |           |
| TASK-063 | Create `features/notifications/admin/use-admin-delivery.ts`. `useSuspenseQuery({ queryKey: notificationsKeys.admin.delivery(id), queryFn: () => fetchAdminDelivery(id) })`.                                                                                                                       |             |           |
| TASK-064 | Create `features/notifications/admin/use-retry-delivery.ts`. `useMutation` calling `fetchRetryDelivery(id)`. On 409 toast `notifications_admin_retry_in_flight`. On 200 toast `notifications_admin_retry_queued` + invalidate `admin.deliveriesAll()`.                                            |             |           |
| TASK-065 | Create `features/notifications/admin/delivery-status-badge.tsx`: pill per `pending                                                                                                                                                                                                                | in_progress | succeeded | failed`. Color tokens. |     |     |
| TASK-066 | Create `features/notifications/admin/deliveries-filter-bar.tsx`: status select, category select, severity select, user-id input (`useDeferredValue`), date range. Sync to URL search params via `useSearch`.                                                                                      |             |           |
| TASK-067 | Create `features/notifications/admin/delivery-row.tsx`: virtualised row. time, event_type, user, plugin, status badge, attempt count.                                                                                                                                                             |             |           |
| TASK-068 | Create `features/notifications/admin/deliveries-table.tsx`: virtualised list w/ `@tanstack/react-virtual`. Sentinel row triggers `fetchNextPage`. Click row opens detail dialog.                                                                                                                  |             |           |
| TASK-069 | Create `features/notifications/admin/delivery-detail-dialog.tsx`: dialog w/ nested `<Suspense>` + `useAdminDelivery(id)`. Renders event payload as collapsible JSON tree (custom lightweight `<JsonTree />` in `shared/components/` if absent — confirm before adding). Last error, retry button. |             |           |
| TASK-070 | Create `features/notifications/admin/deliveries-page.tsx`: top-level page. `<DeliveriesFilterBar />` + `<Suspense fallback={<DeliveriesSkeleton/>}><DeliveriesTable /></Suspense>` + `<DeliveryDetailDialog />` (controlled via search-param `?id=…`).                                            |             |           |
| TASK-071 | Create route file `apps/client/src/routes/_authenticated/_settings/admin/notifications/deliveries.tsx`. `validateSearch` covers filters + `id`. `loader` prefetches first page using filters from search params.                                                                                  |             |           |
| TASK-072 | Update admin sidebar (`nav-items.ts` or layout) to add Notifications link under admin section.                                                                                                                                                                                                    |             |           |
| TASK-073 | Tests `features/notifications/admin/__tests__/deliveries-page.test.tsx`: filter bar URL sync, deferred user-id ⊥ refetch on every keystroke, retry 409 toast, retry 200 invalidate.                                                                                                               |             |           |
| TASK-074 | Run `vp check && vp test`. Commit: "feat(client): add /admin/notifications/deliveries page".                                                                                                                                                                                                      |             |           |

### Implementation Phase 7 — `/admin/settings/notifications` retention form

- GOAL-007: Form for inbox + delivery retention days.

| Task     | Description                                                                                                                                                                                                                                                   | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-075 | Create `features/notifications/admin/use-admin-settings.ts`. `useSuspenseQuery({ queryKey: notificationsKeys.admin.settings(), queryFn: fetchAdminSettings })`.                                                                                               |           |      |
| TASK-076 | Create `features/notifications/admin/use-update-admin-settings.ts`. `useMutation` calling `fetchUpdateAdminSettings(body)`. On success: `queryClient.setQueryData(notificationsKeys.admin.settings(), response)` so clamped values reflect w/o follow-up GET. |           |      |
| TASK-077 | Create `features/notifications/admin/retention-form.tsx`: 2 numeric inputs (`inboxRetentionDays`, `deliveryRetentionDays`), Save button. `useUpdateAdminSettings` mutation. Toast on outcome.                                                                 |           |      |
| TASK-078 | Create `features/notifications/admin/retention-settings-page.tsx`: page wrapper w/ `<Suspense>` boundary + `<RetentionForm />`.                                                                                                                               |           |      |
| TASK-079 | Create route file `apps/client/src/routes/_authenticated/_settings/admin/settings/notifications.tsx`. Loader prefetches admin settings.                                                                                                                       |           |      |
| TASK-080 | Tests `features/notifications/admin/__tests__/retention-form.test.tsx`: server-clamp reflected in inputs after save, error toast on 4xx.                                                                                                                      |           |      |
| TASK-081 | Run `vp check && vp test`. Commit: "feat(client): add admin notifications retention settings".                                                                                                                                                                |           |      |

### Implementation Phase 8 — i18n keys + flag flip + changeset

- GOAL-008: Land Persian + English message keys, flip server flag, ship changeset.

| Task     | Description                                                                                                                                                                                                                                                                                                    | Completed | Date |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-082 | Add ∀ new message keys to `apps/client/messages/notifications/en.json` per design §i18n. Snake-case scalars + plural-declared keys per file convention.                                                                                                                                                        |           |      |
| TASK-083 | Mirror keys to `apps/client/messages/notifications/fa.json` w/ Persian copy.                                                                                                                                                                                                                                   |           |      |
| TASK-084 | `grep -rn "NOTIFICATIONS_ENABLED" apps/server/` to enumerate ∀ gates. If gates ⊥ user-visible only ⇒ remove flag entirely (`apps/server/src/config.ts` + ∀ checks). Else flip default `false` → `true` only.                                                                                                   |           |      |
| TASK-085 | If flag removed: also drop test-only override (`apps/server/src/api/procedures/__tests__/notifications.test.ts:23-30` mocks `NOTIFICATIONS_ENABLED`). Replace test branch w/ unconditional enabled state.                                                                                                      |           |      |
| TASK-086 | Add changeset file `.changeset/notifications-client-ui.md` w/ frontmatter `"@ent-mcp/client": minor` + body 1-2 non-technical sentences (memory rule #11). Example: "Added a notifications page so you can browse, filter, and manage everything sent to you, plus pick which channels each category goes to." |           |      |
| TASK-087 | If flag removed/flipped on server: add second changeset `.changeset/notifications-enabled.md` w/ `"@ent-mcp/server": minor` + 1-sentence body. Skip if no released package change.                                                                                                                             |           |      |
| TASK-088 | Run `vp check && vp test` on full repo. Verify no orphaned `app/notification-*` files remain. Verify `vp run notifications:emit-test` (per server design §Local dev) routes new events through to UI.                                                                                                          |           |      |
| TASK-089 | Final commit: "feat(notifications): enable user-facing notifications". Open PR titled `feat: notifications client UI`. Description references `docs/2026-05-06-notifications-client-design.md` + this plan.                                                                                                    |           |      |

## 3. Alternatives

- **ALT-001**: Multiple PRs — bell wire-up, then inbox, then settings, then admin. **Rejected** by user direction "dev mode, don't mind one PR". Single PR keeps review surface unified.
- **ALT-002**: `useQuery` w/ manual `isPending` skeletons everywhere (no Suspense). **Rejected** — user explicitly directed React 19 concurrent posture; `useSuspenseQuery` + route loaders cleaner for streaming UX.
- **ALT-003**: Keep custom event-emitter + `useState` data layer (avoid TanStack Query). **Rejected** — Query already installed, used in tests + `modal-seasons`. ⊥ deps shift.
- **ALT-004**: Build w/ UI-layer fixtures, swap to API in follow-up. **Rejected** by user direction "endpoint will be available, build against real endpoint".
- **ALT-005**: Hand-roll virtualisation. **Rejected** — `@tanstack/react-virtual` ergonomically aligns w/ existing TanStack stack.
- **ALT-006**: Build new `<NotificationConnectionModal>` instead of reusing `ConnectionModal`. **Rejected** — design constraint REQ-011 reuses, modal already takes injected plugin list.

## 4. Dependencies

- **DEP-001**: `@tanstack/react-virtual` — net-new dep for inbox + admin deliveries virtualisation. Add via `vp add` in TASK-032.
- **DEP-002**: `@tanstack/react-query@^5.100.9` — already installed; `useSuspenseQuery`, `useSuspenseInfiniteQuery`, `useMutation`, `useQueryClient`, `QueryClientProvider`.
- **DEP-003**: `@tanstack/react-router@^1.169.1` — already installed. `createRouter({ context })`, `createRootRouteWithContext`, `useSearch`, `validateSearch`.
- **DEP-004**: `react@^19.2.5` — `useOptimistic`, `useTransition`, `useDeferredValue`, `<Suspense>`, `startTransition`.
- **DEP-005**: `@ent-mcp/shared/notifications` — types, enums, request/response schemas (PR 1-7 of server design).
- **DEP-006**: `hono` Hono RPC client at `@/shared/lib/api` — typed `api.notifications.*` already provides response types via `AppType`.
- **DEP-007**: Existing `<ConnectionModal>` from `features/connections/components/connection-modal.tsx` — reused for add/edit channel.
- **DEP-008**: `sonner` toast — for retry/test/save outcomes via `<Toaster>` mounted in `main.tsx`.
- **DEP-009**: `react-markdown` — already used in `popover-row.tsx`; reused in inbox row + admin detail.
- **DEP-010**: `paraglide` i18n — `apps/client/messages/notifications/{en,fa}.json` + `m.notifications_*` accessors.

## 5. Files

### Created

- **FILE-001**: `apps/client/src/features/notifications/index.ts` — feature barrel export.
- **FILE-002**: `apps/client/src/features/notifications/shared/{query-keys,fetchers,types,error-boundary}.ts` — data layer foundation.
- **FILE-003**: `apps/client/src/features/notifications/bell/{notification-bell,bell-popover-shell,popover-row,popover-empty,popover-skeleton,use-unread-count,use-popover-inbox,index}.{ts,tsx}` — bell + popover live wiring.
- **FILE-004**: `apps/client/src/features/notifications/inbox/{inbox-page,inbox-list,inbox-row,inbox-toolbar,inbox-empty,inbox-skeleton,inbox-bulk-bar,use-inbox,use-inbox-mutations,index}.{ts,tsx}` — `/notifications` page.
- **FILE-005**: `apps/client/src/features/notifications/settings/{notifications-settings-page,channels-section,channel-card,channel-test-button,add-channel-modal,subscriptions-matrix,matrix-row,matrix-cell,settings-skeleton,use-channels,use-plugins,use-categories,use-subscriptions,use-toggle-subscription,use-test-channel,index}.{ts,tsx}` — `/settings/notifications`.
- **FILE-006**: `apps/client/src/features/notifications/admin/{deliveries-page,deliveries-table,deliveries-filter-bar,delivery-detail-dialog,delivery-row,delivery-status-badge,deliveries-skeleton,retention-settings-page,retention-form,use-admin-deliveries,use-admin-delivery,use-retry-delivery,use-admin-settings,use-update-admin-settings,index}.{ts,tsx}` — admin surfaces.
- **FILE-007**: `apps/client/src/routes/_authenticated/_app/notifications.tsx` — inbox route.
- **FILE-008**: `apps/client/src/routes/_authenticated/_settings/settings/notifications.tsx` — settings route.
- **FILE-009**: `apps/client/src/routes/_authenticated/_settings/admin/notifications/deliveries.tsx` — admin deliveries route.
- **FILE-010**: `apps/client/src/routes/_authenticated/_settings/admin/settings/notifications.tsx` — retention form route.
- **FILE-011**: Per-surface `__tests__/*.test.tsx` files.
- **FILE-012**: `.changeset/notifications-client-ui.md` (+ `.changeset/notifications-enabled.md` if server-released change).

### Moved/renamed

- **FILE-013**: `apps/client/src/app/notification-*.tsx` → `apps/client/src/features/notifications/{bell,shared}/*` (8 files).

### Deleted

- **FILE-014**: `apps/client/src/features/notifications/bell/__fixtures__/popover-fixtures.ts` (after Phase 3).

### Modified

- **FILE-015**: `apps/client/src/main.tsx` — add `context: { queryClient }` to `createRouter`.
- **FILE-016**: `apps/client/src/routes/__root.tsx` — switch to `createRootRouteWithContext`.
- **FILE-017**: `apps/client/src/app/top-nav.tsx` — import path + JSX rename.
- **FILE-018**: `apps/client/src/app/{nav-items,bottom-nav,settings-layout}.tsx` — add notification links to nav.
- **FILE-019**: `apps/client/messages/notifications/{en,fa}.json` — new i18n keys.
- **FILE-020**: `apps/client/package.json` — `@tanstack/react-virtual` added.
- **FILE-021**: `.fallowrc.json` — `client-feat-notifications` zone.
- **FILE-022**: `apps/server/src/config.ts` (or env loader) — flag default flip / removal.
- **FILE-023**: `apps/server/src/api/procedures/__tests__/notifications.test.ts` — drop flag-mock branch if flag removed.

## 6. Testing

- **TEST-001**: Bell badge: poll 30s w/ mocked timer; offline pause; mocked unread-count drives dot.
- **TEST-002**: Bell popover: open → list renders from `usePopoverInbox`; mark-read on hover triggers optimistic flip + mutation; dismiss hides row.
- **TEST-003**: Inbox page: infinite scroll loads next cursor; filter chip swap inside `useTransition`; mark-all-read scoped to category filter; bulk delete; empty state per filter.
- **TEST-004**: Inbox mutations: optimistic state rolls back on mutation error; `onSettled` invalidates correct keys.
- **TEST-005**: Settings page: matrix cell toggle optimistic; RBAC-blocked cell disabled w/ tooltip; add-channel modal opens w/ filtered plugin list; test-button outcome toasts.
- **TEST-006**: Admin deliveries: filter URL sync; user-id `useDeferredValue` debounces; retry 409 toast; retry 200 invalidates; detail dialog suspense renders skeleton.
- **TEST-007**: Retention form: server-clamp reflected after save; error toast on 4xx.
- **TEST-008**: Shared: `notificationsKeys` factory hash stability; fetcher error normalisation; error boundary reset clears tree.
- **TEST-009**: Route loaders: `ensureQueryData` calls correct fetcher; suspense skeleton renders during navigation.
- **TEST-010**: Test render adapters reuse `<QueryClientProvider>` wrapper from `features/settings/__tests__/`.

## 7. Risks & Assumptions

- **RISK-001**: Router context migration (TASK-018, TASK-019) breaks existing route type-checking. Mitigation: run `vp check` immediately after; revert if widespread breakage; fall back to `getContext` accessor pattern.
- **RISK-002**: `@tanstack/react-virtual` adds bundle weight. Mitigation: ~12 KB gz; acceptable v1.
- **RISK-003**: `ConnectionModal` reuse may surface coupling: it expects `availablePlugins` typed shape. Mitigation: pass filtered list as-is; modal already accepts `plugin: PluginSummary | null`.
- **RISK-004**: Flag-flip without parity check could expose half-baked state. Mitigation: TASK-088 runs `vp run notifications:emit-test` to verify end-to-end flow before merge.
- **RISK-005**: TanStack Query polling foreground-only may lag right after window focus. Mitigation: `refetchOnWindowFocus: true` (default) handles this naturally.
- **RISK-006**: `useOptimistic` + `useTransition` interaction in inbox row may double-fire mutation if filter swap + click race. Mitigation: TASK-044 covers this in tests.
- **ASSUMPTION-001**: Server endpoints from PRs 1–7 fully implement design contract. Verified by `apps/server/src/api/procedures/notifications/*` + tests.
- **ASSUMPTION-002**: Hono RPC types (`AppType`) accurate for ∀ notification routes.
- **ASSUMPTION-003**: Existing `ConnectionModal` accepts injected plugin list w/o internal changes.
- **ASSUMPTION-004**: `useSuspenseQuery` works inside React 19 + TanStack Router 1.169 loader-driven flow (validated by `modal-seasons` precedent).
- **ASSUMPTION-005**: `apps/client/src/routes/__root.tsx` uses `createRootRoute()` today (verify in TASK-019); switch to `createRootRouteWithContext` is non-breaking for downstream routes.
- **ASSUMPTION-006**: i18n format in `notifications/en.json` is current; new keys mirror existing shape (snake_case scalar | declarative plural).

## 8. Related Specifications / Further Reading

- `docs/2026-05-06-notifications-client-design.md` — client design spec (this plan implements it).
- `docs/2026-04-25-notifications-design.md` — server design + PR 1-7 history + PR 8 outline.
- `docs/2026-04-29-frontend-structure-design.md` — feature-first layout + `features/notifications/` zone definition.
- `docs/2026-04-19-frontend-connections-design.md` — `ConnectionModal` pattern reused in TASK-052.
- React 19 docs — `useOptimistic`, `useTransition`, `useDeferredValue`.
- TanStack Router docs — `createRootRouteWithContext`, route loaders w/ `ensureQueryData`.
- TanStack Query docs — `useSuspenseInfiniteQuery`, `refetchInterval`.
