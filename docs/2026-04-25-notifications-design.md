# Notifications

**Status:** Draft for review
**Date:** 2026-04-25
**Author:** Omid Astaraki
**Supersedes:** N/A — first iteration. Builds on plugin SDK: `docs/2026-04-19-plugin-architecture-design.md` & `docs/2026-04-25-plugin-monorepo-design.md`.

## Summary

General-purpose notification system. Delivers events → users (requested media available, sync ran) & admins (job failed, auth expired, system error). Multiple destinations per user: in-app inbox + N third-party services (`ntfy`, `Telegram`, `Discord` in v1). New providers → plugins implementing `notificationDelivery` capability; core unchanged.

Events typed & centrally registered. Subscriptions coarse — users opt categories (`media`, `sync`, `auth`, `system`) on|off per channel. Category access gated by existing RBAC. Delivery durable: every dispatch persisted, retried on transient fail, surfaced in admin audit view.

Ships with single `notifications.emit()` entry point. v2 → replace body with generic event bus (analytics, audit, other consumers subscribe same events). ∀ call site, plugin, table, retry path, frontend route preserved across migration — only dispatch internals change.

## Goals

- One typed entry point — `notifications.emit(event)` — job-runner hooks, plugin `ctx.notify()`, server modules. Single seam → bus publisher in v2.
- Plugin extensibility via one new capability (`notificationDelivery@v1`). Authors write `deliver()` + `testDelivery()`, reuse existing manifest/auth/config/credential machinery.
- 6 v1 events, user & admin audiences, category × severity × audience taxonomy — scales without touching dispatcher.
- Durable delivery with retry/backoff via existing job runner; cross-instance safe.
- Rich content (images, markdown, inline actions) — plugins opt in via `supportsKinds`. Text-only providers degrade cleanly.
- Built-in in-app inbox with full lifecycle (read/unread/delete) + complete frontend HTTP surface.
- ∀ category access enforced: UI (hide) & dispatcher (drop) via existing `PERMISSIONS` enum.
- v2 migration → generic event bus: zero call-site changes, zero plugin changes, zero schema changes.

## Non-goals

- Generic event bus, analytics consumer, audit-log consumer (v2; foundation laid here). ⊥ v1.
- Multi-channel-per-connection (Slack/Discord-bot style). connection = channel sufficient for v1.
- Plugin-declared event types. Only core declares events.
- Coalescing, throttling, dedup, snooze, quiet hours, scheduled delivery. ⊥ v1.
- Per-event fine-grained subscriptions (categories only v1).
- Localisation. locale param threaded through templates; only `en` ships.
- Real-time push (SSE/WebSocket). Polling v1.
- Email/SMTP, Pushover, Matrix, Mattermost, generic webhook plugins. Community-pluggable from day one.

## Design decisions

|                          | Decision                                       | Rationale                                                            |
| ------------------------ | ---------------------------------------------- | -------------------------------------------------------------------- |
| Audience                 | Users & admins                                 | Same dispatcher, different audience descriptor per event             |
| Emission model           | "B+" — typed registry + single `emit()` seam   | v2 bus migration mechanical; no premature pub/sub                    |
| Subscription granularity | Category-based (4), RBAC-gated                 | Simple grid UI; permissions reuse `PERMISSIONS`                      |
| Plugin contract          | `notificationDelivery@v1`                      | Reuses capability machinery; plugin can be notifier + something else |
| Plugin payload           | Pre-rendered `NotificationMessage` & raw event | Zero-churn default for new event types; opt-in rich rendering        |
| Channel config schema    | Reuse `userConfigSchema`                       | connection = channel v1; no new SDK surface                          |
| Schema format            | JSON Schema                                    | Matches manifest convention; serialises to UI form                   |
| Delivery semantics       | Job-backed, exponential retry                  | Reuses job runner & history; durable; cross-instance safe            |
| In-app inbox             | Built-in plugin                                | Same dispatch path; doubles as audit + zero-config default           |

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

3 new code locations:

1. **`packages/shared/src/notifications/`** — event registry, enums, schemas, `NotificationMessage` contract. Subpath `@ent-mcp/shared/notifications`.
2. **`apps/server/src/notifications/`** — `emit()`, recipient resolver, dispatcher, template loader, delivery job, repos, HTTP routes.
3. **`packages/plugin-sdk/src/capabilities/notification-delivery.ts`** — new capability + `ctx.notify()` plumbing.

Plus 3 first-party plugins: `packages/plugins/{ntfy,telegram,discord}/` & built-in `packages/plugins/inbox/`.

## Data model & shared types

### Enums (single source of truth)

`packages/shared/src/notifications/enums.ts`:

```ts
export const NOTIFICATION_CATEGORIES = ["media", "sync", "auth", "system"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_SEVERITIES = ["info", "warn", "error"] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const NOTIFICATION_DELIVERY_STATUSES = [
  "pending",
  "in_progress",
  "succeeded",
  "failed",
] as const;
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

`packages/shared/src/notifications/events.ts`. Events extend `BaseEvent` → v2 (analytics, audit) extends same root, no refactor:

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

Templates ! populate core text fields. Text-only plugin (`["text"]`) always has something to send.

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
  index(user_id, created_at)
  index(user_id, read_at, created_at desc)
```

- **`notification_deliveries`** = durable record. Survives inbox row delete. Audit.
- **Inbox table** denormalised — list queries need no join to deliveries; render once at delivery time.
- **`correlation_key`** unused v1 but indexed; future coalescing needs no migration.
- **`recipient_connection_id`** = `set null` on connection delete (not cascade) — deliveries survive channel removal as audit.
- **No `notification_channels` table** — channels are connections (§ Plugin contract).

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

Plugin manifest gets one new capability entry alongside existing `userConfigSchema` & `auth.kind`. No new top-level fields.

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

Manifest field ! JSON Schema — matches all other manifest schemas in SDK. Authors preferring Zod DX → convert via `zod-to-json-schema` at module init. Contract requires JSON Schema because same schema drives UI form generator.

### Channel = connection

∀ v1 plugins (`ntfy`, `telegram`, `discord`, `inbox`): connection-row = channel. No `notification_channels` table.

- Channel CRUD reuses `/api/connections` endpoints.
- Channel config = connection's `userConfig`, validated against `userConfigSchema`.
- Multi-target ("two ntfy phones") → create multiple connections.
- Cascade deletes flow naturally: `connections` → `notification_subscriptions` → `notification_deliveries`.

Future plugin needing OAuth-with-multi-target → optional `channelConfigSchema` manifest field, additive. v1 plugins keep working.

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

Inbox plugin = **host-privileged built-in**: ships in-tree with server, runs in host's trusted module space, only plugin allowed to persist server-owned state. Standard `PluginContext` keeps `ctx.db` away from third-party plugins (per plugin architecture doc); inbox receives **extended context** with host-owned repo capability: `ctx.inbox.insert(row)`. Host owns table, schema, mapping. Third-party `notificationDelivery` plugins receive standard `PluginContext`, ⊥ `ctx.inbox` or `ctx.db`.

Auto-created on user signup; backfilled for existing users in PR 4.

### `ctx.notify()`

Plugins emit pre-registered events through context:

```ts
notify: async (event: Omit<NotificationEvent, "id" | "occurredAt">) => {
  await emit({ ...event, id: ulid(), occurredAt: new Date().toISOString() });
};
```

Discriminated union enforces at type level: plugins only emit events registry declares. Plugin-declared event types → v2.

### Error semantics

Plugins signal retryability via existing `pluginError` helper:

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

Delivery job inspects error:

- `retryable: true` → next attempt with backoff `[60s, 5m, 30m, 2h, 12h]`, cap 5 attempts. `retryAfterMs` overrides next interval.
- `retryable: false` → mark `failed` immediately.
- Plain throw, no retryable flag → treat retryable for first 2 attempts, then give up (defensive default).

### Delivery lock & crash recovery

`pending → in_progress → succeeded | failed`. The handler acquires a row by atomic CAS:

```ts
UPDATE notification_deliveries
SET status = 'in_progress', updated_at = now()
WHERE id = :id AND status = 'pending'
```

CAS returning zero rows means another worker (or sweep retrigger) won the race; handler exits early — no duplicate `deliver()`. On crash mid-flight the row is left `in_progress`; the stale-pending sweep (every 5 min) resets `in_progress` rows older than 2 min back to `pending` and re-enqueues them, restoring the CAS contract. `pending` rows older than 2 min are re-enqueued without reset.

### PR 4 implementation deviations

Tracked here for follow-up; revisit before PR 7 (third-party plugins):

- **Backoff schedule:** PR 4 ships flat ~2–5 min retry via the sweep cadence rather than `[60s, 5m, 30m, 2h, 12h]`. `retryAfterMs` is currently ignored. Acceptable while no user-visible channels exist; implement before PR 7.
- **Event ID:** PR 4 uses `randomUUID()` instead of `ulid()`. Loses time-sortable property; revisit if correlation queries become hot.
- **Extended deliver args:** `deliveryId` and `recipientUserId` are passed to all plugins via the deliver `args` (not via host-privileged `ctx.inbox`). Document as internal-only or restrict to host plugins before third-party plugins ship in PR 7.

### Plugin testing helper

`createTestNotificationContext()` ships alongside `createTestPluginContext()`. Plugin authors unit-test `deliver()` & `testDelivery()` without server.

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

**Only** function that produces notifications. ∀ emitters funnel through it. v2: body → `await bus.publish(validated)`, notifications subscriber takes over rest. **Zero caller changes.**

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

Subscription state captured **at emit time**, not at delivery-job-run time. Once delivery row written → ships. User disables subscription → future events skip them; one already-queued delivery may still fire. Documented behaviour.

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

Locale threaded through; only `en` v1. Adding i18n → additive: extend locale union, add per-locale strings.

## HTTP API surface

All routes: `/api/notifications/...` & `/api/admin/notifications/...` in `apps/server/src/api/procedures/notifications/`. ∀ routes require `requireSession`. Hono REST, `zValidator` for bodies.

### Discovery (drives channel-add UI)

```
GET  /api/notifications/plugins
     → { plugins: Array<{
         id: string;            name: string;             description: string;
         authKind: "none" | "oauth_device" | "oauth_redirect" | "custom";
         supportsKinds: NotificationContentKind[];
         userConfigSchema: JSONSchema;
         iconUrl?: string;
       }>}
     Filters plugin registry to those exposing notificationDelivery@v1.

GET  /api/notifications/categories
     → { categories: Array<{
         id: NotificationCategory;     label: string;
         description: string;          requiredPermission: Permission;
         allowed: boolean;
       }>}
     Client uses to hide categories user can't subscribe to.
```

No special permission — `allowed` flag does gating.

### Channels (read-only; mutations stay on `/api/connections`)

```
GET  /api/notifications/channels
     → { channels: Array<ConnectionSummary & { supportsKinds: NotificationContentKind[] }> }
     Returns user's notification-capable connections joined with subscription state
     per channel. One round-trip for /settings/notifications page.

POST /api/notifications/channels/:id/test
     → { ok: boolean; message?: string }
     Calls plugin's notificationDelivery.testDelivery(channelConfig).
     Permission: ACCOUNT_CONNECTIONS.
```

Channel mutations (create/update/delete) reuse `/api/connections`. Single source of truth.

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
     Upserts subscription row. 403 if user lacks category's required permission.
     Validates connection belongs to user.

POST /api/notifications/subscriptions/bulk
     body: {
       updates: Array<{ connectionId: string; category: NotificationCategory; enabled: boolean }>
     }
     → { updated: number }
     For "save all" UX; same per-row validation. `updates` capped at 200 entries —
     oversized payloads → 413. Frontend chunks longer lists.
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
     `nextCursor` opaque to client: `base64url(<created_at_ms>|<id>)`,
     decoded server-side → `(created_at, id) < cursor` keyset predicate.
     The `|` separator is required because epoch ms is interleaved with the
     row id; same encoding is reused by `GET /admin/notifications/deliveries`.
     Stable across pagination even when new rows arrive at head.

GET  /api/notifications/inbox/unread-count
     → { count: number }
     Cheap query for nav badge; clients poll every ~30s while foregrounded.

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

Permission: session only. Row-level scope: `recipient_user_id === sessionUserId`. ∀ mutations idempotent.

### Admin

```
GET  /api/admin/notifications/deliveries
     query: ?status=&category=&severity=&recipientUserId=&from=&to=&cursor=&limit=
     → { deliveries: Array<DeliveryRow>; nextCursor?: string }

GET  /api/admin/notifications/deliveries/:id
     → { delivery: DeliveryRow & { eventPayload: NotificationEvent; attempts?: AttemptRecord[] } }
     `attempts` is reserved for a future per-attempt history table and is
     omitted in v1 until the table exists. Clients should treat the field as
     optional rather than expect an empty array.

POST /api/admin/notifications/deliveries/:id/retry
     → { ok: boolean; rescheduled: boolean }
     Resets attempt_count to 0 (and clears last_error / last_error_code),
     then schedules `notification.deliver` immediately. Refuses with 409
     `notifications.delivery_in_progress` when the row is currently in
     flight — the admin should wait for the current attempt to settle so
     the re-enqueue does not race with an active plugin call.

GET  /api/admin/notifications/settings
     → { inboxRetentionDays: number; deliveryRetentionDays: number }

PATCH /api/admin/notifications/settings
      body: { inboxRetentionDays?: number; deliveryRetentionDays?: number }
      → { ok: true; inboxRetentionDays: number; deliveryRetentionDays: number }
      Returns the persisted (clamped) values alongside `ok` so the client can
      reflect what was actually stored without a follow-up GET.
```

Permission: `ADMIN_SERVER`.

### Frontend route → API mapping

| Page                                      | Routes                                                                                                                                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/settings/notifications` (list + matrix) | `GET /api/notifications/{plugins,channels,categories,subscriptions}`, `PUT /api/notifications/subscriptions/:c/:cat`, `POST /api/notifications/channels/:id/test`. Mutations through `/api/connections`. |
| Add-channel modal                         | `GET /api/notifications/plugins`, `POST /api/connections`, `POST /api/notifications/channels/:id/test`                                                                                                   |
| `/notifications` (inbox)                  | `GET /api/notifications/inbox`, `POST /api/notifications/inbox/{mark-read,mark-unread,mark-all-read}`, `DELETE /api/notifications/inbox`, `DELETE /api/notifications/inbox/all`                          |
| Nav badge                                 | `GET /api/notifications/inbox/unread-count`                                                                                                                                                              |
| `/admin/notifications/deliveries`         | `GET /api/admin/notifications/deliveries`, `GET /api/admin/notifications/deliveries/:id`, `POST /api/admin/notifications/deliveries/:id/retry`                                                           |
| `/admin/settings/notifications`           | `GET/PATCH /api/admin/notifications/settings`                                                                                                                                                            |

### Shared schemas

`packages/shared/src/notifications/schemas.ts` exports request/response Zod schemas ∀ routes above. Subpath: `@ent-mcp/shared/notifications`.

## Testing & observability

### Unit tests

- **Shared:** event registry exhaustiveness, category-permission map coverage, audience union schema rejection.
- **Plugin SDK:** `createTestNotificationContext()` helper; `notify()` plumbing on plugin with capability.
- **∀ first-party plugins:** happy path, retryable failure (5xx, 429), non-retryable failure (401, 403), `testDelivery()`, content-kind handling, golden-file payload snapshots per event type.
- **Server:** (PR 5) `emit()` validation & persistence, `resolveRecipients()` matrix (audience × subscription × permission × enabled), delivery job (success, retry, terminal-fail, dropped-mid-flight), inbox plugin transactional behaviour.

### Integration tests

- End-to-end emit→deliver with stub plugin: 2 channels (stub + inbox), assert both succeed, audit row ∃.
- Retry sweep: stub throws retryable error ×2, succeeds on 3rd; assert backoff schedule, final state, attempt count.
- Subscription-disabled-mid-flight: documents in-flight deliveries still fire.

### Metrics

```
notifications.emitted{event_type, category, severity, audience_kind}     counter
notifications.delivered{plugin_id, status, category}                     counter
notifications.delivery_attempts{plugin_id, outcome}                      counter
notifications.delivery_latency_ms{plugin_id}                             histogram
notifications.queue_depth{status=pending}                                gauge (60s sample)
```

### Logs

∀ delivery attempt → one structured log line via `consola` on `JobRunContext.logger`: `delivery_id`, `plugin_id`, `event_type`, `attempt`, `outcome`, `error_code`.

### Dead-letter

`failed` rows live in `notification_deliveries` (subject to retention), surfaced in admin deliveries list. No separate DLQ table.

### Local dev

- `vp run notifications:emit-test` — emits each event type once with sample payloads against local user.
- `@ent-mcp/notifier-stub` — internal-only test plugin (`private: true`), `auth.kind: "none"`, logging `deliver()`. Integration tests run without network.

## Migration plan to v2 event bus

B+ → v2 mechanical.

### What changes

One file body:

```ts
// v2 — same signature, different body
export async function emit(event: NotificationEvent): Promise<void> {
  const validated = NotificationEventSchema.parse(event);
  await bus.publish(validated);
}
```

∀ emitters (`ctx.notify`, job-runner hooks, server modules) keep calling `emit()` same signature. **Zero call-site changes.**

### What gets added

1. **Bus core (`apps/server/src/bus/`):** `publish`, `subscribe`, transactional outbox table + drainer job, Postgres LISTEN/NOTIFY for low-latency wakeup.
2. **Notifications subscriber:** `bus.subscribe("notification.*", ...)` — runs existing recipient resolver & persists deliveries. ~30 LOC.
3. **Generalised event union.** `BaseEvent` ∃; `BusEvent = NotificationEvent | AnalyticsEvent | AuditEvent | ...`.
4. **Other consumers** → own subscribers when built.

### What stays same

`emit()` signature, ∀ call sites, all plugin code, `notification_deliveries` / `notification_subscriptions` / `notifications_inbox` tables, delivery job + retry logic, `notificationDelivery@v1` capability, `ctx.notify()`, templates, entire HTTP API surface, ∀ shipped first-party plugins.

### Migration order

1. Build bus core + outbox + drainer behind `bus.enabled = false`.
2. Add notifications bus-subscriber, also flagged off.
3. Staging: flip flag, assert parity with direct path.
4. Production flip; keep direct path as fallback for one release.
5. Remove direct path; `emit()` bus-only.
6. Add second consumer (analytics | audit) — actual driver of v2.

### Cost

- Bus core: ~600–800 LOC (outbox + drainer + LISTEN/NOTIFY).
- Subscriber: ~30 LOC.
- One new table (`bus_events_outbox`) + index.
- No data migration of existing notifications.

Effectively cost of building C from day one — deferred until second consumer ∃ to justify it.

## Rollout / phasing

8 PRs, each independently mergeable. PRs 1–7 ⊥ user-visible behaviour; flag flips PR 8.

### Phase 1 — Foundations

- **PR 1 — Shared types & event registry.** `packages/shared/src/notifications/`, subpath export, exhaustiveness tests, no runtime code. Empty changeset.
- **PR 2 — DB migrations + repos.** 3 new tables, Drizzle schema, repos. Empty changeset.
- **PR 3 — Plugin SDK additions.** `notificationDelivery@v1` capability, `ctx.notify()`, `createTestNotificationContext()`. `@ent-mcp/plugin-sdk: minor` — "Plugins can now deliver notifications via the new notification delivery capability."

### Phase 2 — Server core (still ⊥ user-visible change)

- **PR 4 — Emit, dispatch, delivery job.** `apps/server/src/notifications/`, `notification.deliver` job with retry, 6 event templates, built-in `inbox` plugin. Backfill creates `inbox` connection for existing users. Behind `notifications.enabled = false`. `@ent-mcp/server: minor` — "Added the in-app notification inbox so users can review activity from one place."
- **PR 5 — HTTP API surface.** ∀ routes from §HTTP API surface. Schemas in `@ent-mcp/shared/notifications`. Routes → 404 while flag off. Empty changeset.

### Phase 3 — Emitters

- **PR 6 — v1 emit call sites.** Job-runner hook, plugin auth-refresh failure, seerr request status changes, global error sink. Still gated. Empty changeset.

### Phase 4 — First-party plugins

- **PR 7 — ntfy + telegram + discord plugins.** `packages/plugins/{ntfy,telegram,discord}/`, each with `userConfigSchema`, `supportsKinds`, full test coverage. One changeset per plugin: `@ent-mcp/plugin-{ntfy,telegram,discord}: minor` — "Added the X notification provider so you can receive alerts on X."

### Phase 5 — Client UI + flip flag

- **PR 8 — Client UI + enablement.** `/settings/notifications`, `/notifications` inbox, nav badge, `/admin/notifications/deliveries`, `/admin/settings/notifications`. **Flip `notifications.enabled = true`** & remove flag same PR. `@ent-mcp/client: minor` — "Added a notifications page to receive and manage alerts about your media activity."

### PR sizing

| PR      | Rough LOC + tests                               |
| ------- | ----------------------------------------------- |
| 1, 2, 3 | ~200–400 each                                   |
| 4       | ~800–1200 (largest backend; dispatcher + retry) |
| 5       | ~500–700 (route plumbing)                       |
| 6       | ~150 (hook insertions)                          |
| 7       | ~250 per plugin × 3                             |
| 8       | ~800–1200 (client UI; largest frontend)         |

### Out of v1 (deferred, ⊥ lost)

- v2 event bus migration.
- Coalescing, throttling, dedup, snooze, scheduled delivery, quiet hours.
- Multi-channel-per-connection (Slack/Discord-bot multi-target).
- Plugin-declared event types.
- i18n.
- Real-time push (SSE/WebSocket).
- Per-event subscription overrides.
- Email/SMTP, Pushover, Matrix, Mattermost, generic webhook plugins (community-pluggable from day one).

## Risks & open questions

- **Recipient set explosion for admin events.** N admins × M plugins = N×M rows per event. v1 admin set small; if grows → admin-aggregate channel, fans into inbox once per event. Not blocking.
- **Subscription state captured at emit time.** Disabling subscription ⊥ cancel in-flight deliveries. Documented; ≤ 1 trailing notification. Not blocking.
- **Plugin concurrency.** Delivery job runs one row at a time; ∃ N parallel jobs hitting same provider. ntfy/Telegram/Discord rate-limits gentle; future high-volume plugin may need per-plugin concurrency cap. Out of scope; `ctx.pool` ∃ in SDK if needed.
- **Backfill of existing users with inbox connection.** One-time migration in PR 4. If fail midway → idempotent re-run safe (insert if not exists). Not blocking.
- **Discord webhook URL sensitive.** Covered by `x-secret` & existing AES-GCM encryption for `userConfig` values; same protection as ntfy auth headers & Telegram bot tokens.
- **Crash window between tx commit and `jobRunner.trigger()`.** Delivery rows written inside tx (step 3 of `emit()`), but per-row `jobRunner.trigger()` runs after commit (step 4). Crash | OOM-kill between → rows stuck `status: "pending"`, no scheduled job. v1 fix: periodic **stale-pending sweep job** (every 5 min) requeues ∀ `notification_deliveries` rows stuck `pending` > 2 min; idempotent (delivery handler short-circuits when `status !== "pending"`). v2 → transactional outbox inside same tx, drained by bus consumer, removes gap entirely.
