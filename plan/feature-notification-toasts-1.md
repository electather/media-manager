---
goal: Surface fresh notification deliveries as in-app sonner toasts, poll-driven, with one `?after` query-param extension on the existing inbox endpoint
version: 1.0
date_created: 2026-05-13
last_updated: 2026-05-13
owner: Omid Astaraki
status: "Planned"
tags: [feature, frontend, server-min, notifications, toasts, react-19, sonner, broadcast-channel]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Wire newly-arriving `notification_deliveries` into the existing `sonner` `<Toaster />` already mounted in `apps/client/src/main.tsx`. Reuse the existing `useUnreadCount` 30s poll as the freshness signal; on `count` delta lazy-fetch new items via a new `?after=<cursor>` direction-flip on `GET /api/notifications/inbox`. Filter to `severity ≥ warn ∨ event.type ∈ USER_ACTIONABLE_EVENT_TYPES`. Boot-suppress on first observation. Cross-tab dedup via `BroadcastChannel('notifications.toast')`. Toast body click → router nav + mark-read; X → dismiss.

Server change is one query param on an existing route — no new tables, no new routes, no migration.

Web Push, SSE/WebSocket, OS-level `Notification`, snooze/quiet-hours, per-category toast preference are explicit non-goals.

Design: `docs/2026-05-06-notifications-client-design.md § Toasts (2026-05-13)`
Server contract: `docs/2026-04-25-notifications-design.md § HTTP API surface § Inbox` (`?after` row)

---

## 1. Requirements & Constraints

- **REQ-001**: Single PR delivers ∀ server change + client toast layer. ⊥ phase split across releases.
- **REQ-002**: Server adds one optional query param `after` to `GET /api/notifications/inbox`. Existing `cursor` (backward) and new `after` (forward) mutually exclusive; both present → 400. ⊥ new route. ⊥ new endpoint.
- **REQ-003**: Server `listInboxForUser` repo extended w/ direction parameter. `after` mode flips keyset predicate to `>` and `ORDER BY created_at ASC, id ASC`. Same DTO shape. ⊥ migration.
- **REQ-004**: Client toast pipeline lives under `apps/client/src/features/notifications/toasts/`. Sibling features ⊥ import internals; barrel-export via `features/notifications/index.ts`.
- **REQ-005**: `<NotificationToasterHost />` mounted once in `apps/client/src/main.tsx` adjacent to existing `<Toaster />`. Renders `null`. useEffect-driven runtime; ⊥ render path. Mounted above `<RouterProvider>` so toasts fire across all routes.
- **REQ-006**: Detection driver = existing `useUnreadCount` hook. ⊥ new poll. On `count` increase, lazy-fetch via `fetchInboxAfter(cursor, { unreadOnly: true, limit: 10 })`.
- **REQ-007**: First observation per tab seeds `lastSeenCursor` from newest unread item, fires zero toasts (boot-suppress). Subsequent observations toast only items with `(createdAt, id) > lastSeenCursor`.
- **REQ-008**: `lastSeenCursor` lives in-memory per tab (useRef). ⊥ localStorage. Reload | new tab = fresh seed.
- **REQ-009**: Toast filter predicate `isToastable(item)`: `item.severity ∈ {"warn", "error"} ∨ item.eventType ∈ USER_ACTIONABLE_EVENT_TYPES`. Constant: `["media.request.available", "media.request.denied"]`.
- **REQ-010**: Per-poll cap = 3 individual toasts. Overflow (`fresh.length > 3`) → render 3 individual + 1 cluster toast titled w/ overflow count, linking `/notifications`.
- **REQ-011**: Sonner toast duration: 5000ms for `info|warn`, `Infinity` for `error` (sticky). Pass `id: "notif:<itemId>"` to leverage sonner's own dedup.
- **REQ-012**: Toast body click handler = `useMarkRead.mutate([id])` + `router.navigate({ to: actionUrl })` (when present) + `sonnerToast.dismiss(id)`. X button = `dismiss(id)` only; ⊥ mark-read.
- **REQ-013**: Cross-tab dedup via `new BroadcastChannel("notifications.toast")`. Tabs publish `{kind:"toasted", id, at}` on render; lookup `has(id)` skips already-toasted ids. GC entries older than 5 min. Fallback path when `BroadcastChannel === undefined`: per-tab independent toasting (degenerate but functional).
- **REQ-014**: i18n keys added to `apps/client/messages/notifications/{en,fa}.json`:
  - `notifications_toast_cluster_title`
  - `notifications_toast_dismiss_aria`
  - `notifications_toast_action_button`
- **REQ-015**: Toast card component reuses existing `<SeverityIcon />` + `<CategoryChip />` from `features/notifications/shared/`. ⊥ duplicate severity icons or category chips.
- **REQ-016**: Server tests added at `apps/server/src/api/procedures/__tests__/notifications.test.ts` (existing file) covering `?after` happy path, `cursor + after` rejection (400), order assertion (ASC under `after`).
- **REQ-017**: Client tests under `features/notifications/toasts/__tests__/` cover filter table, boot-suppress, overflow cluster, broadcast dedup, click + dismiss semantics, sticky error.
- **REQ-018**: Changeset: `@ent-mcp/client: minor` (toast surfacing of fresh notifications) and `@ent-mcp/server: patch` (forward-cursor query param). Two changeset files.
- **CON-001**: ⊥ new top-level deps. `sonner` already installed; `BroadcastChannel` is platform API.
- **CON-002**: ⊥ flat files > 250 LOC. Decompose per memory rule #17.
- **CON-003**: ⊥ migration, ⊥ schema change.
- **CON-004**: `vp check && vp test` green per commit.
- **CON-005**: `inboxListQuerySchema` `.refine()` (or `.superRefine()`) enforces mutual-exclusion. Wire shape `after?: string`, validated for length-bounded base64url decode (reuse existing `decodeKeysetCursor` helper).
- **CON-006**: Response shape ⊥ change. `nextCursor` semantics inside `after` mode = newer-cursor for continued forward pagination (rarely consumed by toast caller).
- **CON-007**: ⊥ change to `getUnreadCount` query; no need to read alongside `after` path (caller already has count).
- **GUD-001**: One file per concern. Sub-component dir per surface.
- **GUD-002**: Reuse `features/notifications/shared/fetchers.ts` for the new `fetchInboxAfter` (or expose a thin wrapper there).
- **GUD-003**: Reuse `features/notifications/inbox/use-inbox-mutations.ts`'s `useMarkRead`. ⊥ duplicate mutation.
- **GUD-004**: Toast positioning untouched. If conflict observed w/ existing action toasts (e.g., `test-channel` ok/fail), file follow-up; do not preemptively split `<Toaster />` positions.
- **PAT-001**: BroadcastChannel ref + Map state owned by `use-toast-broadcast.ts` hook. ⊥ leaked global singleton.
- **PAT-002**: Cursor advancement helper `advanceCursor(ref, items)` picks max `(createdAt, id)` deterministically; tested independently.
- **PAT-003**: Toast render call wrapped in `toast-renderer.tsx` so the hook owns orchestration only; rendering testable in isolation.

## 2. Implementation Steps

### Implementation Phase 1 — Server `?after` query param

- GOAL-001: Extend the inbox endpoint with forward keyset pagination. Reject mutually-exclusive cursor pair. Add tests asserting ASC order + 400 on conflict. ⊥ visible client change.

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                                | Completed | Date |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-001 | Edit `packages/shared/src/notifications/schemas.ts § inboxListQuerySchema`: add `after: z.string().optional()` to object shape. Add `.refine((d) => !(d.cursor && d.after), { message: "cursor_and_after_mutually_exclusive", path: ["after"] })`. Verify exported `InboxListQuery` type picks up the new optional field.                                                                  |           |      |
| TASK-002 | Edit `apps/server/src/notifications/repos.ts § listInboxForUser`: introduce `direction: "before" | "after"` parameter (default `"before"`). When `"after"`: predicate `(created_at, id) > cursor` (mirror tie-breaker w/ `gt` instead of `lt`); `ORDER BY created_at ASC, id ASC`. When `"before"`: existing behaviour. Same return shape.                                                  |           |      |
| TASK-003 | Edit `apps/server/src/api/procedures/notifications/user.ts § GET /inbox`: parse `q.after` alongside `q.cursor`. If `q.after`: decode via existing `decodeKeysetCursor`, call `listInboxForUser(userId, filters, cursor, q.limit, { direction: "after" })`. Items returned in repo's ASC order; do not reverse client-side. `nextCursor` computation same logic (last item's `(createdAt,id)`). |           |      |
| TASK-004 | Add server tests to `apps/server/src/api/procedures/__tests__/notifications.test.ts`: (a) seed 5 inbox rows over 5 distinct timestamps; `GET /inbox?after=<cursor_before_first>` → returns all 5 in ASC order; (b) `?cursor=X&after=Y` → 400 w/ message containing `cursor_and_after_mutually_exclusive`; (c) `?after=<cursor_after_last>` → empty `items[]`, `nextCursor === undefined`.       |           |      |
| TASK-005 | Add repo-level unit test (alongside existing repo tests if any) for `listInboxForUser` w/ `direction: "after"`: verify predicate flip + sort. If repo lacks tests today, skip this task (covered by route-level test in TASK-004).                                                                                                                                                            |           |      |
| TASK-006 | Run `vp check && vp test --filter @ent-mcp/server`. Commit: `feat(server): add ?after forward-cursor to /inbox`. Write `.changeset/<slug>.md` w/ `@ent-mcp/server: patch` line: "Inbox listing now supports forward keyset pagination via an `after` query parameter."                                                                                                                       |           |      |

### Implementation Phase 2 — Client foundation

- GOAL-002: Scaffold `features/notifications/toasts/` w/ types, constants, broadcast hook, fetcher, filter. ⊥ wire into runtime yet.

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                                                                       | Completed | Date |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-007 | Create `apps/client/src/features/notifications/toasts/constants.ts` exporting `USER_ACTIONABLE_EVENT_TYPES` (literal tuple-as-const), `MAX_TOASTS_PER_CYCLE = 3`, `BROADCAST_CHANNEL_NAME = "notifications.toast"`, `BROADCAST_WINDOW_MS = 5 * 60_000`.                                                                                                                                                                            |           |      |
| TASK-008 | Create `apps/client/src/features/notifications/toasts/is-toastable.ts` exporting `isToastable(item: InboxItem): boolean`. Pure function: returns `item.severity === "warn" || item.severity === "error" || (item.eventType !== undefined && USER_ACTIONABLE_EVENT_TYPES.includes(item.eventType))`. Note: confirm `InboxItem` DTO exposes `eventType`; if not, fall back to filtering only on `severity` and file follow-up.        |           |      |
| TASK-009 | Audit `InboxItem` DTO at `apps/server/src/notifications/repos.ts § inboxRowToDto` for `eventType` field. If absent (likely — current schema has `category` but not `eventType`), add it: server side persist `event_type` in `notifications_inbox` table OR derive on-the-fly from `notification_deliveries.event_type` via join. Cheapest path: add nullable `event_type` column on `notifications_inbox` + backfill in PR. Decide implementation in this task; if column-add too invasive, downgrade REQ-009 to severity-only filter and skip `USER_ACTIONABLE_EVENT_TYPES` until follow-up. Document decision inline in `is-toastable.ts`.                                                                                                                                                                                                                                                                            |           |      |
| TASK-010 | Create `apps/client/src/features/notifications/toasts/fetch-inbox-after.ts` exporting `fetchInboxAfter(cursor: string, opts: { unreadOnly?: boolean; limit?: number }): Promise<InboxPage>`. Wraps `api.notifications.inbox.$get({ query: { after: cursor, unreadOnly: opts.unreadOnly ? "1" : undefined, limit: String(opts.limit ?? 10) } })`. Throws `NotificationsApiError` on `!res.ok` (reuse existing class from `features/notifications/shared/`).                                                                                |           |      |
| TASK-011 | Create `apps/client/src/features/notifications/toasts/use-toast-broadcast.ts` per design § BroadcastChannel dedup. Returns `{ has, publish }`. Internally manages `Map<id, epochMs>` w/ GC on lookup, `BroadcastChannel` instance behind `typeof BroadcastChannel !== "undefined"` guard. Cleanup channel `close()` in effect return.                                                                                              |           |      |
| TASK-012 | Add tests `features/notifications/toasts/__tests__/is-toastable.test.ts`: cartesian table — severities × event types — assert expected boolean outcomes (warn → true, error → true, info+non-actionable → false, info+`media.request.available` → true).                                                                                                                                                                          |           |      |
| TASK-013 | Add tests `features/notifications/toasts/__tests__/use-toast-broadcast.test.ts`: mock `BroadcastChannel` (assign global before import); render two hook instances, publish from A, assert `has` on B returns true after message dispatch. Assert GC: insert id w/ stub epoch, advance fake timers > 5 min, lookup returns false.                                                                                                   |           |      |
| TASK-014 | Run `vp check && vp test --filter @ent-mcp/client`. Commit: `feat(client): scaffold notification toast foundation`.                                                                                                                                                                                                                                                                                                                |           |      |

### Implementation Phase 3 — Toast rendering + orchestration hook

- GOAL-003: Render side, orchestration hook, mount in `main.tsx`. End of phase: toasts visibly fire on real notifications in dev.

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                                                                              | Completed | Date |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-015 | Create `apps/client/src/features/notifications/toasts/toast-renderer.tsx`. Export `renderToast(item, deps)` and `renderClusterToast(count, deps)`. `deps = { router, markReadMutation, broadcast }`. Use `sonnerToast.custom(...)`, pass `id: "notif:<id>"`, duration as per REQ-011. Card component `<NotificationToastCard>` w/ `<SeverityIcon />`, title, body (truncate at 140 chars), X button (dismiss only), body-click → nav + mark-read.        |           |      |
| TASK-016 | Create `apps/client/src/features/notifications/toasts/use-notification-toaster.ts` per design § Hook contract. Effect keyed on `countResult?.count`. On first observation (`prevCountRef.current === null`): call internal `seedCursor` (fetch `?after=<empty>` w/ `limit:1` OR call `fetchInboxPage({}, null)` → take first), set `lastSeenCursorRef`, return without toasting. On count delta > 0: fetch via `fetchInboxAfter`, filter, dedup, render. Cap @ `MAX_TOASTS_PER_CYCLE`; overflow → cluster. Advance cursor to newest returned item's `(createdAt, id)`. |           |      |
| TASK-017 | Create `apps/client/src/features/notifications/toasts/notification-toaster-host.tsx`. Component `NotificationToasterHost` returns `null`. Calls `useNotificationToaster()`. Default export + named.                                                                                                                                                                                                                                              |           |      |
| TASK-018 | Wire `notifications/index.ts` to re-export `NotificationToasterHost`. Update `notifications/toasts/index.ts` barrel.                                                                                                                                                                                                                                                                                                                              |           |      |
| TASK-019 | Edit `apps/client/src/main.tsx`: import `NotificationToasterHost` from `@/features/notifications`, mount adjacent to `<Toaster />` inside `<QueryClientProvider>`. Component must mount above `<RouterProvider>` (so hook runs across all routes).                                                                                                                                                                                          |           |      |
| TASK-020 | Add i18n keys to `apps/client/messages/notifications/en.json`: `notifications_toast_cluster_title` (ICU plural `"{count, plural, one {# more new notification} other {# more new notifications}}"`), `notifications_toast_dismiss_aria` (`"Dismiss notification"`), `notifications_toast_action_button` (`"View"`).                                                                                                                                |           |      |
| TASK-021 | Mirror to `apps/client/messages/notifications/fa.json` w/ Persian copy. Run paraglide codegen step (`vp run` or whatever the project uses for paraglide build).                                                                                                                                                                                                                                                                                    |           |      |
| TASK-022 | Run `vp check && vp test --filter @ent-mcp/client`. Verify type errors zero. Commit: `feat(client): mount notification toaster host`.                                                                                                                                                                                                                                                                                                              |           |      |

### Implementation Phase 4 — Tests for the orchestration hook

- GOAL-004: Cover the end-to-end client behaviour: boot-suppress, overflow cluster, click semantics, error stickiness, broadcast dedup at hook level.

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                                                                          | Completed | Date |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---- |
| TASK-023 | Create `features/notifications/toasts/__tests__/use-notification-toaster.test.tsx`: build `renderHook` wrapper w/ mock `useUnreadCount` returning value via injected query client (seed `notificationsKeys.unreadCount()` w/ count). Mock `fetchInboxAfter` w/ vi.fn. Assert: initial render w/ `count=5` → 0 calls to `sonnerToast.custom`. Re-render w/ `count=7` → fetch fires, 2 toasts queued (after filter).                  |           |      |
| TASK-024 | Same file: overflow case — count delta = 6, mock returns 6 items all toastable → assert 3 calls to `renderToast` + 1 call to `renderClusterToast` w/ `count: 3` (overflow remainder).                                                                                                                                                                                                                                                |           |      |
| TASK-025 | Same file: dedup case — populate `broadcast.has(id)` mock → assert deduped ids ⊥ in render call list.                                                                                                                                                                                                                                                                                                                                |           |      |
| TASK-026 | Create `features/notifications/toasts/__tests__/toast-renderer.test.tsx`: render `<NotificationToastCard />` directly via Testing Library w/ memory router + query client. Click card body → assert `useMarkRead.mutate` called once w/ `[id]`, router `navigate` called once w/ `actionUrl`. Click X → assert `sonnerToast.dismiss` called, `markRead` NOT called.                                                                |           |      |
| TASK-027 | Same file: severity sticky — pass `severity: "error"` item, assert `sonnerToast.custom` invoked w/ `duration: Infinity` (or `Number.POSITIVE_INFINITY`); `info` item w/ `duration: 5000`.                                                                                                                                                                                                                                            |           |      |
| TASK-028 | Run `vp check && vp test --filter @ent-mcp/client`. Commit: `test(client): cover notification toast orchestration + rendering`.                                                                                                                                                                                                                                                                                                       |           |      |

### Implementation Phase 5 — Wiring polish + manual verification

- GOAL-005: End-to-end smoke. Trigger a real notification via existing `host.notifications.demo` job and confirm toast renders. Changeset, fmt, lint, full suite.

| Task     | Description                                                                                                                                                                                                                                                                                                                                                                                          | Completed | Date |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- | ---- |
| TASK-029 | Start dev environment: `vp install`, `vp dev`. Log in as test user w/ inbox channel + media subscription enabled. Trigger `host.notifications.demo` w/ `eventType: "media.request.available"` and `userId: <self>` from admin UI (or via direct job invocation). Confirm sonner toast appears in browser within ≤ 30s. Click toast body → confirms nav to media detail + inbox badge decrements.                            |           |      |
| TASK-030 | Repeat manual smoke w/ `eventType: "job.run.failed"` (admin audience, severity `error`) — assert toast is sticky (does not auto-dismiss after 5s). Click X → confirm toast vanishes, badge count unchanged (no mark-read).                                                                                                                                                                                |           |      |
| TASK-031 | Cross-tab smoke: open two tabs of the same user. Trigger one demo job. Confirm toast appears in only one tab (the one that received the broadcast first); other tab silent. Switch to silent tab → ⊥ toast replays. Counts match across tabs after a poll cycle.                                                                                                                                              |           |      |
| TASK-032 | Burst smoke: fire 5 demo notifications rapid-fire (severity warn). Confirm UI shows 3 individual toasts + 1 cluster toast `"+2 more new notifications"`. Click cluster → nav to `/notifications`.                                                                                                                                                                                                                |           |      |
| TASK-033 | Run `vp check` (fmt + lint + type) full repo. Fix any oxlint/oxfmt issues. Run `vp test` full repo. ∀ green.                                                                                                                                                                                                                                                                                                |           |      |
| TASK-034 | Add changeset `.changeset/notification-toasts.md`: `"@ent-mcp/client": minor` body — "Fresh notifications now surface as in-app toasts when you're on the page, with click-to-open and dismiss actions." Server changeset from TASK-006 already in place.                                                                                                                                                |           |      |
| TASK-035 | Commit final + open PR. Summary, test plan, link spec section. Run PR template fill-in per `.github/PULL_REQUEST_TEMPLATE/pull_request_template.md`.                                                                                                                                                                                                                                                                            |           |      |

## 3. Decision Log

| Decision                                                       | Rationale                                                                                                                                       |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Extend `/inbox` w/ `?after` vs new `/inbox/since` endpoint     | Same resource, same shape, same filters — `before`/`after` pattern (Atom, GitHub) idiomatic. Single Zod schema, single repo method, one query-param diff. |
| Boot-suppress catch-up vs cap+cluster on first observation     | Cleanest semantics: toasts represent events that arrived **while this tab was running**. Backlog visible in bell badge + inbox page, not as 50 stacking toasts. |
| In-memory cursor vs localStorage persist                       | Matches boot-suppress: new tab | reload = fresh start. localStorage would replay events from prior session, undoing the suppression.                      |
| BroadcastChannel dedup vs leader-elect                         | Cheap (~20 LOC). Foreground tab dedup sufficient — backgrounded tabs already paused via `refetchIntervalInBackground: false`. Leader-elect = YAGNI v1. |
| Severity ≥ warn ∪ user-actionable event-types as filter        | Warn/error = correctness/health signals user must see. Info noise (sync.succeeded) suppressed. Media request lifecycle is info-severity but user-actionable → carve-out via event-type allowlist. |
| Mount toaster host above RouterProvider                        | Notifications can arrive while user is on any route. Mounting at router root would couple pipeline to route lifecycle.                                |
| Reuse `useUnreadCount` as driver vs add a dedicated poll       | Existing poll already runs at the right cadence, w/ correct background-pause semantics. Adding a second poll = redundant work + two query keys to invalidate. |

## 4. Risks

- **`InboxItem.eventType` absence.** TASK-009 inspects current DTO; if missing, two paths: (a) add nullable `event_type` column to `notifications_inbox` and backfill, OR (b) downgrade REQ-009 to severity-only and ship event-type carve-out as follow-up. Decision recorded inline in `is-toastable.ts`.
- **Sonner toast position conflicts** w/ existing action toasts (test-channel ok/fail). Mitigation: monitor in dev smoke (TASK-029–032). If conflict observed, split `<Toaster />` positions in follow-up PR; do not preempt.
- **30s detection latency.** Acceptable v1. Future SSE migration replaces the upstream driver; toast pipeline downstream unchanged.
- **BroadcastChannel undefined in old browsers.** Fallback: per-tab independent toasting. Degenerate but functional. No blocking action.
- **Same-tab reload double-toast.** Sonner's own `id: "notif:<id>"` dedup prevents same-id second toast within sonner's queue window. Acceptable.

## 5. Out of v1 (deferred, ⊥ lost)

- Web Push / Service Worker / VAPID — separate spec.
- SSE / WebSocket — separate spec; same pipeline downstream.
- Per-category toast on/off in subscription matrix — add column when first asked.
- Quiet hours, snooze, per-event suppression.
- Native OS `Notification` API.
- Cluster toast → mark-all-read scoping.
- Configurable toast position.
