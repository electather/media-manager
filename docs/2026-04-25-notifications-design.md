# Notifications

**Status:** Draft for review
**Date:** 2026-04-25
**Author:** Omid Astaraki
**Supersedes:** N/A — first iteration of the notification system. Builds on the plugin SDK described in `docs/2026-04-19-plugin-architecture-design.md` and `docs/2026-04-25-plugin-monorepo-design.md`.

## Summary

Add a general-purpose notification system that delivers events to users (their requested media became available, a sync ran) and to administrators (a job failed, a connection's auth expired, the server hit a system error). Notifications can be delivered to multiple destinations per user — an in-app inbox plus any number of third-party services (`ntfy`, `Telegram`, `Discord` shipped in v1). New providers are added as plugins implementing a single `notificationDelivery` capability; nothing about adding a provider requires changes to core.

Events are typed and centrally registered. Subscriptions are coarse — users opt categories (`media`, `sync`, `auth`, `system`) on or off per channel. Category access is gated by the existing RBAC permissions. Delivery is durable: every dispatch is persisted, retried on transient failures, and surfaced for operators in an admin audit view.

The system ships with a single, narrow `notifications.emit()` entry point. In v2 we replace its body with a generic event bus (so analytics, audit, and other consumers can subscribe to the same events). Every call site, plugin, table, retry path, and frontend route is preserved across that migration — only the dispatch internals change.

## Goals

- One typed entry point — `notifications.emit(event)` — used by job-runner hooks, plugin code via `ctx.notify()`, and server modules. Designed as a single seam that becomes the bus publisher in v2.
- Plugin extensibility through one new capability (`notificationDelivery@v1`). Plugin authors write a single `deliver()` plus `testDelivery()` and reuse the existing manifest, auth, config, and credential machinery.
- Six v1 events covering both user and admin audiences, with a category × severity × audience taxonomy that scales without touching the dispatcher.
- Durable delivery with retry/backoff via the existing job runner; cross-instance safe.
- Rich content support — images, markdown, inline actions — that plugins opt into via `supportsKinds`. Text-only providers degrade cleanly.
- Built-in in-app inbox with full lifecycle (read/unread/delete) and a complete frontend HTTP surface.
- Every category access enforced at both the UI (hide) and the dispatcher (drop) using the existing `PERMISSIONS` enum.
- v2 migration to a generic event bus that requires zero call-site changes, zero plugin changes, and zero schema changes to the notification tables.

## Non-goals

- Generic event bus, analytics consumer, or audit-log consumer (v2; foundation laid here).
- Multi-channel-per-connection (one OAuth, many target channels — Slack/Discord-bot style). Connection-equals-channel is sufficient for the v1 plugin set.
- Plugin-declared event types. Only core declares events; plugins emit pre-registered events.
- Coalescing, throttling, dedup, snooze, quiet hours, scheduled delivery.
- Per-event fine-grained subscriptions (categories only in v1).
- Localisation. The locale parameter is threaded through templates so future i18n is additive; only `en` ships.
- Real-time push to client (SSE/WebSocket). Polling for v1.
- Email/SMTP, Pushover, Matrix, Mattermost, generic webhook plugins. Community-pluggable from day one through the SDK.

## Design decisions

|                          | Decision                                         | Rationale                                                                               |
| ------------------------ | ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Audience                 | Both users and admins                            | Same dispatcher, different audience descriptors per event                               |
| Emission model           | "B+" — typed registry + single `emit()` seam     | Keeps v2 bus migration mechanical; no premature pub/sub infra                           |
| Subscription granularity | Category-based (4 categories), RBAC-gated        | Simple grid UI; permissions reuse existing `PERMISSIONS`                                |
| Plugin contract          | New capability `notificationDelivery@v1`         | Reuses the existing capability machinery; a plugin can be a notifier and something else |
| Plugin payload           | Pre-rendered `NotificationMessage` AND raw event | Default zero-churn for plugins on new event types; opt-in rich rendering                |
| Channel config schema    | Reuse existing `userConfigSchema`                | Connection equals channel for v1 plugins; no new SDK surface                            |
| Schema format            | JSON Schema                                      | Matches existing manifest convention; serialises to UI form                             |
| Delivery semantics       | Job-backed with exponential retry                | Reuses existing job runner & history; durable; cross-instance safe                      |
| In-app inbox             | Yes, modeled as a built-in plugin                | Same dispatch path; doubles as audit + zero-config default                              |

## Architecture overview

```
                       ┌────────────────────────────────────┐
emitter (job runner,   │                                    │
plugin, server module) │   notifications.emit(event)        │
       ──────────────► │   (single dispatch seam — body     │
                       │    swaps for bus.publish() in v2)  │
                       └────────────────┬───────────────────┘
                                        │
                          ┌─────────────▼─────────────┐
                          │ resolveRecipients(event)  │
                          │ ─ audience filter         │
                          │ ─ permission gate         │
                          │ ─ subscription match      │
                          └─────────────┬─────────────┘
                                        │
                  ┌─────────────────────▼─────────────────────┐
                  │ for each (connection) → write delivery    │
                  │ row status=pending, schedule delivery job │
                  └─────────────────────┬─────────────────────┘
                                        │
                  ┌─────────────────────▼─────────────────────┐
                  │ notification.deliver job (per row)        │
                  │ ─ render template → NotificationMessage   │
                  │ ─ resolve plugin notificationDelivery cap │
                  │ ─ call plugin.deliver(ctx, msg, rawEvent, │
                  │       channelConfig)                       │
                  │ ─ on success: row=succeeded               │
                  │ ─ on retryable fail: backoff (5x cap)     │
                  │ ─ on terminal fail: row=failed (audit)    │
                  └───────────────────────────────────────────┘
```

Three new code locations:

1. **`packages/shared/src/notifications/`** — event registry, enums, schemas, `NotificationMessage` contract. Subpath export `@ent-mcp/shared/notifications`.
2. **`apps/server/src/notifications/`** — `emit()`, recipient resolver, dispatcher, template loader, delivery job, repos, HTTP routes.
3. **`packages/plugin-sdk/src/capabilities/notification-delivery.ts`** — the new capability, plus `ctx.notify()` plumbing.

Plus three first-party plugins: `packages/plugins/{ntfy,telegram,discord}/`, and a built-in `packages/plugins/inbox/`.

## Data model & shared types

### Enums (single source of truth)

`packages/shared/src/notifications/enums.ts`:

```ts
export const NOTIFICATION_CATEGORIES = ["media", "sync", "auth", "system"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_SEVERITIES = ["info", "warn", "error"] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const NOTIFICATION_DELIVERY_STATUSES = ["pending", "succeeded", "failed"] as const;
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

export const NOTIFICATION_CONTENT_KINDS = ["text", "markdown", "image", "actions"] as const;
export type NotificationContentKind = (typeof NOTIFICATION_CONTENT_KINDS)[number];

export const NOTIFICATION_CATEGORY_PERMISSION: Record<NotificationCategory, Permission> = {
  media: PERMISSIONS.MEDIA_ACTIVITY,
  sync: PERMISSIONS.ACCOUNT_CONNECTIONS,
  auth: PERMISSIONS.ACCOUNT_CONNECTIONS,
  system: PERMISSIONS.ADMIN_SERVER,
};
```

### Event registry

`packages/shared/src/notifications/events.ts`. Events extend a `BaseEvent` so v2 (analytics, audit) can extend the same root without a refactor:

```ts
export interface BaseEvent {
  id: string; // ULID, set by emit() if absent
  occurredAt: string; // ISO-8601, set by emit() if absent
  source?: string; // plugin id or server module that emitted
}

export const NOTIFICATION_EVENT_TYPES = [
  "job.run.failed",
  "connection.auth.expired",
  "connection.sync.succeeded",
  "media.request.available",
  "media.request.denied",
  "system.error",
] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export type NotificationAudience =
  | { kind: "user"; userId: string }
  | { kind: "admin"; permission: Permission };

export interface NotificationEventEnvelope<T extends NotificationEventType, P> extends BaseEvent {
  type: T;
  category: NotificationCategory;
  severity: NotificationSeverity;
  audience: NotificationAudience;
  correlationKey?: string; // indexed; reserved for future coalescing
  payload: P;
}

export type NotificationEvent =
  | NotificationEventEnvelope<"job.run.failed", { jobId: string; runId: string; error: string }>
  | NotificationEventEnvelope<"connection.auth.expired", { connectionId: string; pluginId: string }>
  | NotificationEventEnvelope<
      "connection.sync.succeeded",
      { connectionId: string; pluginId: string; itemCount: number }
    >
  | NotificationEventEnvelope<
      "media.request.available",
      { requestId: string; mediaId: string; title: string; posterUrl?: string }
    >
  | NotificationEventEnvelope<
      "media.request.denied",
      { requestId: string; mediaId: string; title: string; posterUrl?: string; reason?: string }
    >
  | NotificationEventEnvelope<"system.error", { errorSource: string; message: string }>;
```

### Neutral message contract

What plugins receive in `deliver()`:

```ts
export interface NotificationAction {
  label: string;
  url: string;
  style?: "default" | "primary" | "danger";
}

export interface NotificationMessage {
  // Core — every plugin must render this. Always populated by the template.
  title: string;
  body: string;
  severity: NotificationSeverity;
  category: NotificationCategory;
  actionUrl?: string;

  // Rich — optional. Plugins ignore what they don't support.
  bodyMarkdown?: string;
  image?: { url: string; alt?: string };
  thumbnail?: { url: string; alt?: string };
  actions?: NotificationAction[];

  structured?: Record<string, string | number | boolean>;
}
```

Templates always populate the core text fields, so a text-only plugin (`["text"]`) always has something to send.

### Server tables

`apps/server/src/db/schema/notifications.ts`:

```
notification_subscriptions
  connection_id   text  fk -> connections.id  (cascade delete)
  category        text  enum(NOTIFICATION_CATEGORIES)
  enabled         bool  default true
  primary key(connection_id, category)

notification_deliveries
  id                text  pk
  event_id          text                  -- BaseEvent.id, for cross-table joins
  event_type        text  enum(NOTIFICATION_EVENT_TYPES)
  event_payload     text                  -- JSON-serialised envelope, audit + retry source (SQLite text, like `job_runs.result`)
  recipient_connection_id text fk -> connections.id  (set null on delete)
  recipient_user_id text  fk -> users.id  (cascade delete)
  status            text  enum(NOTIFICATION_DELIVERY_STATUSES)
  attempt_count     int   default 0
  last_error        text  null
  last_error_code   text  null
  provider_message_id text null
  correlation_key   text  null
  created_at        timestamptz
  updated_at        timestamptz
  index(recipient_user_id, created_at desc)
  index(status, updated_at)
  index(correlation_key)

notifications_inbox
  id              text  pk
  delivery_id     text  fk -> notification_deliveries.id  (set null on delete)
  user_id         text  fk -> users.id  (cascade delete)
  title           text
  body            text
  severity        text
  category        text
  action_url      text  null
  image_url       text  null
  image_alt       text  null
  read_at         timestamptz null
  created_at      timestamptz
  index(user_id, read_at, created_at desc)
```

Notes:

- **`notification_deliveries` is the durable record** — preserved for audit even after the user deletes their inbox row.
- **Inbox table is denormalised** so list queries don't need to join the deliveries table; rendering happens once at delivery time.
- **`correlation_key`** is unused in v1 but indexed; future coalescing ("3 jobs failed in 60s → one notification") needs no migration.
- **`recipient_connection_id`** is `set null` on connection delete (not cascade) so deliveries survive as audit even if the user removes the channel.
- **No `notification_channels` table** — channels are connections (Section: "Plugin contract" below).

## Plugin contract & SDK changes

### New capability: `notificationDelivery@v1`

`packages/plugin-sdk/src/capabilities/notification-delivery.ts`:

```ts
import type {
  NotificationMessage,
  NotificationEvent,
  NotificationContentKind,
} from "@ent-mcp/shared/notifications";

export interface NotificationDeliveryCapabilityV1<TConfig = unknown> {
  /**
   * Render and ship a single notification. Throw to trigger retry.
   * Returns a provider-side id when available (used for future read-receipts).
   */
  deliver(
    ctx: PluginContext<unknown, unknown, unknown, unknown>,
    args: {
      message: NotificationMessage; // pre-rendered neutral payload
      event: NotificationEvent; // raw typed event for plugin-specific rendering
      channelConfig: TConfig; // decrypted, validated against userConfigSchema
    },
  ): Promise<{ providerMessageId?: string }>;

  /**
   * Validate config + verify reachability. Called from the "Test" button in UI
   * and once at channel-create time. Should NOT actually deliver.
   */
  testDelivery(
    ctx: PluginContext<unknown, unknown, unknown, unknown>,
    args: { channelConfig: TConfig },
  ): Promise<{ ok: boolean; message?: string }>;
}
```

### Manifest declaration

The plugin manifest gets one new capability entry, alongside two existing ones — `userConfigSchema` (channel config) and `auth.kind`. No new top-level fields.

```ts
manifest: {
  id: "ntfy",
  name: "ntfy",
  description: "Self-hosted push notifications via ntfy.sh.",
  version: "0.1.0",
  sdkVersion: "^1.0.0",
  auth: { kind: "none" },
  capabilities: {
    notificationDelivery: {
      version: "v1",
      scope: "user",
      supportsKinds: ["text", "image", "actions"],
    },
  },
  userConfigSchema: {
    type: "object",
    properties: {
      serverUrl: { type: "string", format: "uri", title: "ntfy server URL" },
      topic:     { type: "string", title: "Topic", minLength: 1 },
      authHeader:{ type: "string", title: "Auth header", "x-secret": true },
    },
    required: ["serverUrl", "topic"],
  },
}
```

The manifest field is **JSON Schema**, matching every other manifest schema in the SDK. Plugin authors who prefer Zod DX can convert via `zod-to-json-schema` at module init. The contract requires JSON Schema because the same schema drives the UI form generator.

### Channel = connection

For v1 plugins (`ntfy`, `telegram`, `discord`, `inbox`) the connection-row is the channel. There is no separate `notification_channels` table. This means:

- Channel CRUD reuses the existing `/api/connections` endpoints.
- Channel config is the connection's `userConfig`, validated against `userConfigSchema`.
- Multi-target ("two ntfy phones") is achieved by creating multiple connections.
- Cascade deletes flow naturally from `connections` to `notification_subscriptions` and `notification_deliveries`.

When a future plugin needs OAuth-with-multi-target (e.g. proper Slack bot), we add an optional `channelConfigSchema` manifest field guarded by "only relevant if declared." That's purely additive; v1 plugins keep working.

### Built-in inbox plugin

`packages/plugins/inbox/`:

```ts
manifest: {
  id: "inbox",
  name: "In-app inbox",
  version: "0.1.0",
  sdkVersion: "^1.0.0",
  auth: { kind: "none" },
  capabilities: {
    notificationDelivery: {
      version: "v1",
      scope: "user",
      supportsKinds: ["text", "markdown", "image", "actions"],
    },
  },
  userConfigSchema: { type: "object", properties: {}, additionalProperties: false },
}

deliver: async (ctx, { message, event }) => {
  await ctx.inbox.insert({
    userId: /* recipient */,
    deliveryId: /* delivery row id */,
    title: message.title,
    body: message.body,
    severity: message.severity,
    category: message.category,
    actionUrl: message.actionUrl ?? null,
    image: message.image,
  });
  return {};
}
```

The inbox plugin is a **host-privileged built-in**: it ships in-tree with the server, runs in the host's trusted module space, and is the only plugin allowed to persist server-owned state. To keep the standard `PluginContext` contract honest (no `ctx.db` for third-party plugins, per the plugin architecture doc), the inbox receives an **extended context** with a host-owned repository capability: `ctx.inbox.insert(row)`. The host owns the table, the schema, and the mapping from `NotificationMessage` to columns; the plugin only signals "persist this delivery for the user". Third-party `notificationDelivery` plugins receive the standard `PluginContext` and never see `ctx.inbox` or `ctx.db`.

Auto-created on user signup; backfilled for existing users in PR 4.

### `ctx.notify()`

Plugins can emit pre-registered events through their context:

```ts
notify: async (event: Omit<NotificationEvent, "id" | "occurredAt">) => {
  await emit({ ...event, id: ulid(), occurredAt: new Date().toISOString() });
};
```

The discriminated union enforces at the type level that plugins can only emit events the registry declares. Plugin-declared event types are deferred to v2.

### Error semantics

Plugins signal retryability through the existing `pluginError` helper:

```ts
import { pluginError } from "@ent-mcp/plugin-sdk";

if (res.status === 429) {
  throw pluginError("rate_limited", "ntfy 429", { retryable: true, retryAfterMs: 60_000 });
}
if (res.status >= 500) {
  throw pluginError("upstream_error", `ntfy ${res.status}`, { retryable: true });
}
if (res.status === 401 || res.status === 403) {
  throw pluginError("auth_failed", "ntfy auth rejected", { retryable: false });
}
```

The delivery job inspects the error:

- `retryable: true` → schedule next attempt with backoff `[60s, 5m, 30m, 2h, 12h]`, capped at 5 attempts. `retryAfterMs` overrides the next interval.
- `retryable: false` → mark `failed` immediately.
- Plain throw with no retryable flag → treat as retryable for the first 2 attempts, then give up (defensive default).

### Plugin testing helper

`createTestNotificationContext()` ships alongside the existing `createTestPluginContext()`. Lets plugin authors unit-test `deliver()` and `testDelivery()` without a server.

## Emission & dispatch flow

### `emit()` — the single seam

`apps/server/src/notifications/emit.ts`:

```ts
export async function emit(
  event: Omit<NotificationEvent, "id" | "occurredAt"> &
    Partial<Pick<BaseEvent, "id" | "occurredAt">>,
): Promise<void> {
  const enriched = {
    id: event.id ?? ulid(),
    occurredAt: event.occurredAt ?? new Date().toISOString(),
    ...event,
  } as NotificationEvent;

  // 1. Validate the envelope (type, audience shape, severity).
  const validated = NotificationEventSchema.parse(enriched);

  // 2. Resolve recipients.
  const recipients = await resolveRecipients(validated);

  // 3. Persist one delivery row per recipient (single tx).
  const deliveries = await db.transaction(async (tx) => {
    return tx
      .insert(notificationDeliveries)
      .values(
        recipients.map((r) => ({
          id: nanoid(),
          eventId: validated.id,
          eventType: validated.type,
          eventPayload: validated,
          recipientConnectionId: r.connectionId,
          recipientUserId: r.userId,
          status: "pending",
          attemptCount: 0,
          correlationKey: validated.correlationKey ?? null,
        })),
      )
      .returning();
  });

  // 4. Schedule a delivery job per row.
  for (const d of deliveries) {
    await jobRunner.trigger("notification.deliver", { deliveryId: d.id });
  }
}
```

This is the **only** function that produces notifications. Every emitter funnels through it. In v2 the body becomes `await bus.publish(validated)` and a notifications subscriber takes over the rest. **No caller code changes.**

### Recipient resolution

```ts
async function resolveRecipients(event: NotificationEvent): Promise<Recipient[]> {
  // 1. Find candidate users based on audience. Both branches are async so
  //    `candidateUserIds` is uniformly `Promise<string[]>` — no conditional awaits.
  const candidateUserIds = await match(event.audience, {
    user: ({ userId }) => Promise.resolve([userId]),
    admin: ({ permission }) =>
      db
        .select({ id: users.id })
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .where(arrayContains(roles.permissions, permission))
        .then((rows) => rows.map((r) => r.id)),
  });

  // 2. Find each user's notification-capable, enabled connections subscribed to this category.
  const conns = await db.query.connections.findMany({
    where: and(
      inArray(connections.userId, candidateUserIds),
      eq(connections.enabled, true),
      inArray(connections.pluginId, getNotificationCapablePluginIds()),
    ),
    with: {
      subscriptions: {
        where: and(
          eq(notificationSubscriptions.category, event.category),
          eq(notificationSubscriptions.enabled, true),
        ),
      },
    },
  });

  // 3. Defense in depth: re-check the user has the category permission at dispatch time.
  return conns
    .filter((c) => c.subscriptions.length > 0)
    .filter((c) => userHasPermission(c.userId, NOTIFICATION_CATEGORY_PERMISSION[event.category]))
    .map((c) => ({ connectionId: c.id, userId: c.userId }));
}
```

Subscription state is captured **at emit time**, not at delivery-job-run time. Once a delivery row is written, it ships. If a user disables a subscription, future events skip them; one already-queued delivery may still fire. Documented behaviour.

### Delivery job

`apps/server/src/jobs/handlers/notification-deliver.ts`:

```ts
registerJobHandler("notification.deliver", {
  kind: "triggerable",
  perInputDedup: (input) => `notification.deliver:${input.deliveryId}`,
  async handler(ctx, input: { deliveryId: string }) {
    const delivery = await db.query.notificationDeliveries.findFirst({
      where: eq(notificationDeliveries.id, input.deliveryId),
    });
    if (!delivery || delivery.status !== "pending") return; // idempotent

    const event = delivery.eventPayload as NotificationEvent;
    const message = renderTemplate(event, "en");

    if (!delivery.recipientConnectionId) {
      await markFailed(delivery.id, "connection_deleted");
      return;
    }
    const conn = await db.query.connections.findFirst({
      where: eq(connections.id, delivery.recipientConnectionId),
    });
    if (!conn) {
      await markFailed(delivery.id, "connection_deleted");
      return;
    }

    const plugin = pluginRegistry.get(conn.pluginId);
    const pluginCtx = await buildPluginContext(conn, ctx);

    try {
      const result = await plugin.capabilities.notificationDelivery.deliver(pluginCtx, {
        message,
        event,
        channelConfig: conn.userConfig,
      });
      await markSucceeded(delivery.id, result.providerMessageId);
    } catch (err) {
      await handleDeliveryFailure(delivery, err);
    }
  },
});
```

### v1 emission sources

| Source                                                    | Event(s)                                          | Audience                     |
| --------------------------------------------------------- | ------------------------------------------------- | ---------------------------- |
| Job runner post-finish (`apps/server/src/jobs/runner.ts`) | `job.run.failed`                                  | `admin` (`admin:server`)     |
| Job runner post-finish, sync-classified jobs              | `connection.sync.succeeded`                       | `user` (`triggeredByUserId`) |
| Plugin auth-refresh failure path                          | `connection.auth.expired`                         | `user` (connection owner)    |
| Seerr request status changes                              | `media.request.available`, `media.request.denied` | `user` (requester)           |
| Global `ErrorSink` for unhandled critical errors          | `system.error`                                    | `admin` (`admin:server`)     |

### Templates

`apps/server/src/notifications/templates/<event-type>.ts` — one file per event type. Signature:

```ts
type NotificationTemplate<T extends NotificationEventType> = (
  event: Extract<NotificationEvent, { type: T }>,
  locale: "en",
) => NotificationMessage;
```

Locale is threaded through but only `en` exists in v1. Adding i18n later is additive: extend the locale union and add per-locale strings.

## HTTP API surface

All routes mounted under `/api/notifications/...` and `/api/admin/notifications/...` in `apps/server/src/api/procedures/notifications/`. Every route requires `requireSession`. Hono REST style, `zValidator` for bodies.

### Discovery (drives the channel-add UI)

```
GET  /api/notifications/plugins
     → { plugins: Array<{
         id: string;            name: string;             description: string;
         authKind: "none" | "oauth_device" | "oauth_redirect" | "custom";
         supportsKinds: NotificationContentKind[];
         userConfigSchema: JSONSchema;
         iconUrl?: string;
       }>}
     Filters the plugin registry to those exposing notificationDelivery@v1.

GET  /api/notifications/categories
     → { categories: Array<{
         id: NotificationCategory;     label: string;
         description: string;          requiredPermission: Permission;
         allowed: boolean;
       }>}
     Used by client to hide categories the user can't subscribe to.
```

No special permission — the `allowed` flag does the gating.

### Channels (read-only; mutations stay on `/api/connections`)

```
GET  /api/notifications/channels
     → { channels: Array<ConnectionSummary & { supportsKinds: NotificationContentKind[] }> }
     Returns user's notification-capable connections joined with subscription state
     for each channel. One round-trip for the /settings/notifications page.

POST /api/notifications/channels/:id/test
     → { ok: boolean; message?: string }
     Calls the plugin's notificationDelivery.testDelivery(channelConfig).
     Permission: ACCOUNT_CONNECTIONS.
```

Channel mutations (create / update / delete) reuse the existing `/api/connections` endpoints. Single source of truth for connection state.

### Subscriptions

```
GET  /api/notifications/subscriptions
     → { subscriptions: Array<{
         connectionId: string;       category: NotificationCategory;
         enabled: boolean;
       }>}

PUT  /api/notifications/subscriptions/:connectionId/:category
     body: { enabled: boolean }
     → { ok: true }
     Upserts subscription row. 403 if user lacks the category's required permission.
     Validates the connection belongs to the user.

POST /api/notifications/subscriptions/bulk
     body: {
       updates: Array<{ connectionId: string; category: NotificationCategory; enabled: boolean }>
     }
     → { updated: number }
     For "save all" UX; same per-row validation.
```

Permission: `ACCOUNT_CONNECTIONS`.

### Inbox

```
GET  /api/notifications/inbox
     query: ?unreadOnly=&category=&severity=&cursor=&limit=
     → {
         items: Array<{
           id: string;          createdAt: string;       readAt: string | null;
           title: string;       body: string;            severity: NotificationSeverity;
           category: NotificationCategory;
           actionUrl: string | null;
           image: { url: string; alt?: string } | null;
         }>,
         nextCursor?: string;
         unreadCount: number;
       }
     Default limit 50, max 200.

GET  /api/notifications/inbox/unread-count
     → { count: number }
     Cheap query for the nav badge; clients poll every ~30s while foregrounded.

POST /api/notifications/inbox/mark-read
     body: { ids: string[] }                    → { updated: number }

POST /api/notifications/inbox/mark-unread
     body: { ids: string[] }                    → { updated: number }

POST /api/notifications/inbox/mark-all-read
     body: { category?: NotificationCategory }  → { updated: number }

DELETE /api/notifications/inbox
       body: { ids: string[] }                  → { deleted: number }

DELETE /api/notifications/inbox/all
       body: { readOnly?: boolean; olderThan?: string /* ISO */ }
       → { deleted: number }
```

Permission: session only. Row-level scoping by `recipient_user_id === sessionUserId`. All mutations idempotent.

### Admin

```
GET  /api/admin/notifications/deliveries
     query: ?status=&category=&severity=&recipientUserId=&from=&to=&cursor=&limit=
     → { deliveries: Array<DeliveryRow>; nextCursor?: string }

GET  /api/admin/notifications/deliveries/:id
     → { delivery: DeliveryRow & { eventPayload: NotificationEvent; attempts: AttemptRecord[] } }

POST /api/admin/notifications/deliveries/:id/retry
     → { ok: boolean; rescheduled: boolean }
     Resets attempt_count to 0, schedules immediately.

GET  /api/admin/notifications/settings
     → { inboxRetentionDays: number; deliveryRetentionDays: number }

PATCH /api/admin/notifications/settings
      body: { inboxRetentionDays?: number; deliveryRetentionDays?: number }
      → { ok: true }
```

Permission: `ADMIN_SERVER`.

### Frontend route to API mapping

| Page                                      | Routes                                                                                                                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/settings/notifications` (list + matrix) | `GET /api/notifications/{plugins,channels,categories,subscriptions}`, `PUT /api/notifications/subscriptions/:c/:cat`, `POST /api/notifications/channels/:id/test`. Mutations through existing `/api/connections`. |
| Add-channel modal                         | `GET /api/notifications/plugins`, `POST /api/connections`, `POST /api/notifications/channels/:id/test`                                                                                                            |
| `/notifications` (inbox)                  | `GET /api/notifications/inbox`, `POST /api/notifications/inbox/{mark-read,mark-unread,mark-all-read}`, `DELETE /api/notifications/inbox`, `DELETE /api/notifications/inbox/all`                                   |
| Nav badge                                 | `GET /api/notifications/inbox/unread-count`                                                                                                                                                                       |
| `/admin/notifications/deliveries`         | `GET /api/admin/notifications/deliveries`, `GET /api/admin/notifications/deliveries/:id`, `POST /api/admin/notifications/deliveries/:id/retry`                                                                    |
| `/admin/settings/notifications`           | `GET/PATCH /api/admin/notifications/settings`                                                                                                                                                                     |

### Shared schemas

`packages/shared/src/notifications/schemas.ts` exports request/response Zod schemas for every route above. Subpath: `@ent-mcp/shared/notifications`.

## Testing & observability

### Unit tests

- **Shared:** event registry exhaustiveness, category-permission map coverage, audience union schema rejection.
- **Plugin SDK:** `createTestNotificationContext()` helper; `notify()` plumbing on a plugin with the capability.
- **Each first-party plugin:** happy path, retryable failure (5xx, 429), non-retryable failure (401, 403), `testDelivery()`, content-kind handling, golden-file payload snapshots per event type.
- **Server:** `emit()` validation and persistence, `resolveRecipients()` matrix (audience × subscription × permission × enabled), delivery job (success, retry, terminal-fail, dropped-mid-flight), inbox plugin transactional behaviour.

### Integration tests

- End-to-end emit→deliver with stub plugin: two channels (stub + inbox), assert both succeed, audit row exists.
- Retry sweep: stub throws retryable error twice, succeeds on third; assert backoff schedule, final state, attempt count.
- Subscription-disabled-mid-flight: documents that in-flight deliveries still fire.

### Metrics

```
notifications.emitted{event_type, category, severity, audience_kind}     counter
notifications.delivered{plugin_id, status, category}                     counter
notifications.delivery_attempts{plugin_id, outcome}                      counter
notifications.delivery_latency_ms{plugin_id}                             histogram
notifications.queue_depth{status=pending}                                gauge (60s sample)
```

### Logs

Every delivery attempt produces one structured log line via the existing `consola` instance on `JobRunContext.logger`: `delivery_id`, `plugin_id`, `event_type`, `attempt`, `outcome`, `error_code`.

### Dead-letter

`failed` rows live in `notification_deliveries` (subject to retention) and are surfaced in the admin deliveries list. No separate DLQ table.

### Local dev

- `vp run notifications:emit-test` — script that emits each event type once with sample payloads against a local user.
- `@ent-mcp/notifier-stub` — internal-only test plugin (`private: true`) with `auth.kind: "none"` and a logging `deliver()`. Lets integration tests run without network.

## Migration plan to v2 event bus

The whole point of B+ is that v2 is mechanical.

### What changes

One file body:

```ts
// v2 — same signature, different body
export async function emit(event: NotificationEvent): Promise<void> {
  const validated = NotificationEventSchema.parse(event);
  await bus.publish(validated);
}
```

Every emitter (`ctx.notify`, job-runner hooks, server modules) keeps calling `emit()` with the same signature. **Zero call-site changes.**

### What gets added

1. **Bus core (`apps/server/src/bus/`):** `publish`, `subscribe`, transactional outbox table + drainer job, Postgres LISTEN/NOTIFY for low-latency wakeup.
2. **Notifications subscriber:** `bus.subscribe("notification.*", ...)` — runs the existing recipient resolver and persists deliveries. ~30 LOC.
3. **Generalised event union.** `BaseEvent` already exists; `BusEvent = NotificationEvent | AnalyticsEvent | AuditEvent | ...`.
4. **Other consumers** appear as their own subscribers when they're actually built.

### What stays the same

`emit()` signature, every call site, all plugin code, `notification_deliveries` / `notification_subscriptions` / `notifications_inbox` tables, the delivery job + retry logic, `notificationDelivery@v1` capability, `ctx.notify()`, templates, the entire HTTP API surface, and every shipped first-party plugin.

### Migration order

1. Build bus core + outbox + drainer behind `bus.enabled = false`.
2. Add notifications bus-subscriber, also flagged off.
3. Staging: flip flag, assert parity with direct path.
4. Production flip; keep direct path as fallback for one release.
5. Remove direct path; `emit()` is bus-only.
6. Add second consumer (analytics or audit) — the actual driver of v2.

### Cost

- Bus core: ~600–800 LOC (mostly outbox + drainer + LISTEN/NOTIFY).
- Subscriber: ~30 LOC.
- One new table (`bus_events_outbox`) plus an index.
- No data migration of existing notifications.

Effectively the cost of building C from day one — but deferred until a second consumer exists to justify it.

## Rollout / phasing

Eight PRs, each independently mergeable. Earlier PRs don't change user-visible behaviour; the flag flips in PR 8.

### Phase 1 — Foundations

- **PR 1 — Shared types & event registry.** `packages/shared/src/notifications/`, subpath export, exhaustiveness tests, no runtime code. Empty changeset.
- **PR 2 — DB migrations + repos.** Three new tables, Drizzle schema, repositories. Empty changeset.
- **PR 3 — Plugin SDK additions.** `notificationDelivery@v1` capability, `ctx.notify()`, `createTestNotificationContext()`. `@ent-mcp/plugin-sdk: minor` — "Plugins can now deliver notifications via the new notification delivery capability."

### Phase 2 — Server core (still no user-visible change)

- **PR 4 — Emit, dispatch, delivery job.** `apps/server/src/notifications/`, `notification.deliver` job with retry, six event templates, built-in `inbox` plugin. Backfill creates `inbox` connection for existing users. Behind `notifications.enabled = false`. `@ent-mcp/server: minor` — "Added the in-app notification inbox so users can review activity from one place."
- **PR 5 — HTTP API surface.** All routes from §HTTP API surface. Schemas in `@ent-mcp/shared/notifications`. Routes return 404 while the flag is off. Empty changeset.

### Phase 3 — Emitters

- **PR 6 — v1 emit call sites.** Job-runner hook, plugin auth-refresh failure, seerr request status changes, global error sink. Still gated. Empty changeset.

### Phase 4 — First-party plugins

- **PR 7 — ntfy + telegram + discord plugins.** `packages/plugins/{ntfy,telegram,discord}/`, each with `userConfigSchema`, `supportsKinds`, full test coverage. One changeset entry per plugin: `@ent-mcp/plugin-{ntfy,telegram,discord}: minor` — "Added the X notification provider so you can receive alerts on X."

### Phase 5 — Client UI + flip the flag

- **PR 8 — Client UI + enablement.** `/settings/notifications`, `/notifications` inbox, nav badge, `/admin/notifications/deliveries`, `/admin/settings/notifications`. **Flip `notifications.enabled = true`** and remove the flag in the same PR. `@ent-mcp/client: minor` — "Added a notifications page to receive and manage alerts about your media activity."

### PR sizing

| PR      | Rough LOC + tests                               |
| ------- | ----------------------------------------------- |
| 1, 2, 3 | ~200–400 each                                   |
| 4       | ~800–1200 (largest backend; dispatcher + retry) |
| 5       | ~500–700 (route plumbing)                       |
| 6       | ~150 (hook insertions)                          |
| 7       | ~250 per plugin × 3                             |
| 8       | ~800–1200 (client UI; largest frontend)         |

### Out of v1 (deferred, not lost)

- v2 event bus migration.
- Coalescing, throttling, dedup, snooze, scheduled delivery, quiet hours.
- Multi-channel-per-connection (Slack/Discord-bot multi-target).
- Plugin-declared event types.
- i18n.
- Real-time push to client (SSE/WebSocket).
- Per-event subscription overrides.
- Email/SMTP, Pushover, Matrix, Mattermost, generic webhook plugins (community-pluggable from day one).

## Risks & open questions

- **Recipient set explosion for admin events.** Every admin gets a delivery row per admin event. With N admins and M plugins, it's N×M rows per event. v1 admin set is small; if it grows, add an admin-aggregate channel that fans into the inbox once per event rather than once per admin. Not blocking.
- **Subscription state captured at emit time.** Disabling a subscription does not cancel in-flight deliveries. Documented; surfaces as at most one trailing notification. Not blocking.
- **Plugin concurrency.** The delivery job runs one row at a time; nothing prevents N parallel jobs hitting the same provider. ntfy/Telegram/Discord rate-limits are gentle, but a future high-volume plugin may need a per-plugin concurrency cap. Out of scope; the pool-signaling mechanism (`ctx.pool`) exists in the SDK if needed.
- **Backfill of existing users with inbox connection.** One-time migration in PR 4. If migration fails midway, idempotent re-run is safe (insert if not exists). Not blocking.
- **Discord webhook URL is sensitive.** Already covered by `x-secret` and the existing AES-GCM encryption for `userConfig` values; same protection ntfy auth headers and Telegram bot tokens get.
- **Crash window between transaction commit and `jobRunner.trigger()`.** The delivery rows are written inside a transaction (step 3 of `emit()`), but the per-row `jobRunner.trigger()` calls run after the commit (step 4). A crash or OOM-kill between the two leaves rows in `status: "pending"` with no scheduled job. v1 closes this with a periodic **stale-pending sweep job** (every 5 minutes) that requeues any `notification_deliveries` row stuck in `pending` for more than 2 minutes; the job is idempotent because the delivery handler short-circuits when `status !== "pending"`. v2 replaces this with a transactional outbox written inside the same transaction and drained by the bus consumer, removing the gap entirely.
