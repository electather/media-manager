# Primary-Connection Picker (metadata@v1) — Design

**Issue:** [#476](https://github.com/electather/nama/issues/476)
**Date:** 2026-05-22
**Status:** Draft

## 1. Problem

`primary_with_enrichment` is a dispatch strategy used by `metadata@v1` only.
It promotes one provider's result to "base", then deep-merges scalar gaps from
other providers. The backend reads the choice from `primary_connections`, but
nothing writes to that table in production — every user falls through to
`providers[0]` (the first installed plugin that advertises the capability).

Users with multiple metadata providers (e.g. TMDB + TVDB) cannot pin which one
"wins" for movies or TV. This design wires the existing service into an HTTP
API and a settings UI so a user can pick their primary metadata provider per
media type.

## 2. Goals / Non-Goals

### Goals

- Per-user, per-`(capability, mediaType)` primary-provider selection.
- Reuse the existing `primary_connections` table, service functions, and
  atomic upsert (#458 fix already merged as `330b2189`).
- Surface picker in settings/connections with `Movies` + `TV` rows.
- Invalidate per-capability cache on every write.
- Picker only renders when the user has ≥2 eligible connections.

### Non-Goals

- Extending other capabilities to `primary_with_enrichment`. The API is
  generic by shape, but the only consumer today is `metadata@v1`. New
  capabilities slot in by adding rows to the existing schema; no design
  re-work needed.
- Auto-discovering which `(capability, mediaType)` rows to render — the
  client keeps a static `PRIMARY_PROVIDER_ROWS` list. (Per-connection
  eligibility *is* derived from `PluginSummary.userScopedCapabilities`;
  that's row population, not row discovery.)
- Admin-side "system default" primary (no analogue exists today).
- Changing the strategy fallback when no row exists (`providers[0]` stays).

## 3. Architecture

```
Settings/Connections page
└── <PrimaryProvidersCard> (renders iff ≥2 eligible)
    ├── usePrimaryConnections()           ── GET /api/connections/primary
    ├── useSetPrimaryConnection()         ── POST /api/connections/primary
    └── useClearPrimaryConnection()       ── DELETE /api/connections/primary
                │
                ▼
   apps/server/src/api/procedures/connections-primary.ts (new)
                │
                ▼
   apps/server/src/media/service/primary-preference.ts (existing)
                │
                ▼
   primary_connections (PK: userId, capabilityKey, mediaType)
```

Decision: **capability-scoped UI, generic server API**. Server endpoints
take `{capabilityKey, mediaType, connectionId}` so a future capability is
zero-work on the server. Client hard-codes the two `metadata@v1` rows
(Movies, TV) because that's the only `primary_with_enrichment` consumer.

## 4. Server

### 4.1 New module

File: `apps/server/src/api/procedures/connections-primary.ts`

Mounted under the existing `connectionsApp` Hono sub-app so `requireSession`
+ `requirePermission(PERMISSIONS.ACCOUNT_CONNECTIONS)` middleware applies
without duplication. The sibling-file split keeps `connections.ts` (4.5K
already) from growing; primary-selection is conceptually orthogonal to the
connection CRUD verbs in that file.

```ts
// apps/server/src/api/procedures/connections-primary.ts
import { Hono } from "hono";
import {
  primaryConnectionSetSchema,
  primaryConnectionClearSchema,
} from "@nama/shared/connections";
import { sessionUserId } from "../../auth";
import { primaryConnectionsService } from "../../connections/primary-service";
import { zValidator } from "../../diagnostics/validator";

export const connectionsPrimaryApp = new Hono()
  .get("/", async (c) => {
    const rows = await primaryConnectionsService.listForUser(sessionUserId(c));
    return c.json({ primaries: rows });
  })
  .post("/", zValidator("json", primaryConnectionSetSchema), async (c) => {
    const body = c.req.valid("json");
    await primaryConnectionsService.set({
      userId: sessionUserId(c),
      capabilityKey: body.capabilityKey,
      mediaType: body.mediaType,
      connectionId: body.connectionId,
    });
    return c.json({ ok: true });
  })
  .delete("/", zValidator("json", primaryConnectionClearSchema), async (c) => {
    const body = c.req.valid("json");
    await primaryConnectionsService.clear({
      userId: sessionUserId(c),
      capabilityKey: body.capabilityKey,
      mediaType: body.mediaType,
    });
    return c.json({ ok: true });
  });
```

The existing `connectionsApp` mounts it: `.route("/primary", connectionsPrimaryApp)`.

### 4.2 Service wrapper

File: `apps/server/src/connections/primary-service.ts` (new)

Wraps the existing `primary-preference.ts` service functions with:

1. **Ownership check** — `connectionId` must belong to `userId`. The
   existing helper `requireConnection` in `connections/service.ts` (line
   105) is private; promote it to an exported helper (or extract into a
   shared `connections/internal/require-connection.ts`) so the new
   primary service can reuse it without duplicating the lookup +
   404 mapping. This is a deliberate cross-module surface change for the
   `connections/` module, not an incidental detail.
2. **Capability validation** — the connection's plugin manifest must
   advertise the requested `capabilityKey` as a user-scoped capability.
   Source of truth: `capabilityRegistry.get(pluginId)?.capabilities` — same
   data driving `PluginSummary.userScopedCapabilities`.
3. **Cache invalidation** — call `invalidateUserCache(userId)` after every
   mutation. The dispatcher caches results per-capability keyed on userId;
   flipping primary must drop the entry or the user sees stale "wrong
   provider" data until TTL.
4. **GET shape** — return `Array<{capabilityKey, mediaType, connectionId}>`
   for the calling user. No join to `serviceConnections`; the client
   already has the connections list and reconciles by id.

```ts
// apps/server/src/connections/primary-service.ts
export const primaryConnectionsService = {
  async listForUser(userId: string): Promise<PrimaryConnectionRow[]> {
    /* SELECT all primary_connections WHERE userId; map sentinel "_" → null */
  },
  async set(args: {
    userId: string;
    capabilityKey: string;
    mediaType: MediaType | null;
    connectionId: string;
  }): Promise<void> {
    await assertOwnedAndSupportsCapability(args);
    await setPrimaryConnection(args);          // atomic upsert
    await invalidateUserCache(args.userId);
  },
  async clear(args: {
    userId: string;
    capabilityKey: string;
    mediaType: MediaType | null;
  }): Promise<void> {
    await clearPrimaryConnection(args);
    await invalidateUserCache(args.userId);
  },
};
```

`assertOwnedAndSupportsCapability` throws:

- `notFound("connection.not_found")` — connection missing or not owned.
- `unprocessable("connection.capability_unsupported")` — plugin's manifest
  doesn't advertise `capabilityKey` at user scope.

### 4.3 Shared schemas

File: `packages/shared/src/connections/schemas.ts` (extend existing)

```ts
import { MEDIA_TYPES } from "../media/enums";

const capabilityKeySchema = z.string().regex(/^[a-z][a-zA-Z0-9]*@v\d+$/);
const optionalMediaTypeSchema = z.enum(MEDIA_TYPES).nullable();

export const primaryConnectionSetSchema = z.object({
  capabilityKey: capabilityKeySchema,
  mediaType: optionalMediaTypeSchema,
  connectionId: z.string().uuid(),
});
export const primaryConnectionClearSchema = z.object({
  capabilityKey: capabilityKeySchema,
  mediaType: optionalMediaTypeSchema,
});
```

`mediaType: null` on the wire ↔ sentinel `"_"` in DB (existing convention,
see `primary-preference.ts:10`).

### 4.4 Response shape

`GET /api/connections/primary`:

```ts
{
  primaries: Array<{
    capabilityKey: string;          // e.g. "metadata@v1"
    mediaType: "movie" | "tv" | null;
    connectionId: string;
  }>;
}
```

`POST` / `DELETE`: `{ ok: true }`. Standard error shape from
`diagnostics/http-errors.ts` on failure (`connection.not_found`,
`connection.capability_unsupported`).

## 5. Client

### 5.1 New feature surface

All work lives in `apps/client/src/features/settings-connections/`. Follows
`frontend-feature-architecture` skill (no new top-level feature folder
since primary selection is part of the existing connections settings).

```
settings-connections/
├── components/
│   ├── settings-connections-page.tsx     (existing — render new card)
│   └── primary-providers-card.tsx        (new)
├── hooks/
│   ├── use-primary-connections.ts        (new — GET, Suspense)
│   ├── use-set-primary-connection.ts     (new — mutation + optimistic)
│   └── use-clear-primary-connection.ts   (new — mutation + optimistic)
└── lib/
    ├── fetchers.ts                        (extend)
    ├── query-keys.ts                      (extend)
    └── primary-rows.ts                    (new — capability×mediaType row defs)
```

### 5.2 Row definition

`primary-rows.ts` declares the rows the UI renders. Today, two entries:

```ts
import { m } from "@/paraglide/messages";

export const PRIMARY_PROVIDER_ROWS = [
  {
    capabilityKey: "metadata@v1",
    mediaType: "movie",
    labelMessage: m.settings_connections_primary_movies_label,
  },
  {
    capabilityKey: "metadata@v1",
    mediaType: "tv",
    labelMessage: m.settings_connections_primary_tv_label,
  },
] as const;
```

Adding a new `primary_with_enrichment` capability later = append a row.

### 5.3 Component

```tsx
// primary-providers-card.tsx
export function PrimaryProvidersCard() {
  const connections = useConnections();
  const primaries = usePrimaryConnections();

  return (
    <>
      {PRIMARY_PROVIDER_ROWS.map((row) => {
        const eligible = connections.filter(
          (c) =>
            c.enabled &&
            c.status === "connected" &&
            c.plugin.userScopedCapabilities.some(
              (cap) => `${cap.id}@${cap.version}` === row.capabilityKey,
            ),
        );
        if (eligible.length < 2) return null;
        const current = primaries.find(
          (p) =>
            p.capabilityKey === row.capabilityKey &&
            p.mediaType === row.mediaType,
        );
        return (
          <PrimaryProviderRow
            key={`${row.capabilityKey}:${row.mediaType}`}
            row={row}
            eligible={eligible}
            currentConnectionId={current?.connectionId ?? null}
          />
        );
      }).filter(Boolean)}
    </>
  );
}
```

Card itself only renders when at least one row has ≥2 eligible connections.
That's checked once at the card level so the section header doesn't appear
for users with a single provider.

Each `<PrimaryProviderRow>` renders a `<Select>` (shadcn) with:

- First option: **Auto (provider order)** — value `__auto__`. Picking it
  fires `clearPrimaryConnection`.
- One option per eligible connection (`displayName || plugin.name`).

Optimistic updates: on submit, set the local cache entry to the new value
immediately; rollback on error. Reuse `useOptimisticArrayMutation` from
`@/shared/hooks/use-optimistic-array-mutation`, the same hook
`use-toggle-enabled.ts` uses. The cache being mutated is
`settingsConnectionsKeys.primary()` (an array of
`PrimaryConnectionRow`); the `update` callback replaces or appends the
row for the matching `(capabilityKey, mediaType)` pair, and the clear
mutation removes it.

### 5.4 Query keys

```ts
export const settingsConnectionsKeys = {
  all: ["settings-connections"] as const,
  connections: () => [...settingsConnectionsKeys.all, "connections"] as const,
  availablePlugins: () => [...settingsConnectionsKeys.all, "available-plugins"] as const,
  primary: () => [...settingsConnectionsKeys.all, "primary"] as const,
};
```

### 5.5 Fetchers

```ts
export async function fetchPrimaryConnections(): Promise<PrimaryConnectionRow[]> {
  const body = await readJson(await api.connections.primary.$get());
  return body.primaries;
}
export async function fetchSetPrimaryConnection(input: {
  capabilityKey: string;
  mediaType: MediaType | null;
  connectionId: string;
}): Promise<void> {
  await readJson(await api.connections.primary.$post({ json: input }));
}
export async function fetchClearPrimaryConnection(input: {
  capabilityKey: string;
  mediaType: MediaType | null;
}): Promise<void> {
  await readJson(await api.connections.primary.$delete({ json: input }));
}
```

### 5.6 Visibility rules

- Card hidden when no row has ≥2 eligible connections.
- Per-row: hidden when the row's own eligible list has <2.
- Disabled / non-`connected` connections never appear in the dropdown.
- If a previously-pinned connection becomes ineligible **by being
  disabled / expired**, `GET /primary` still returns the row (the DB row
  exists), but the dropdown shows "Auto (was *DisplayName*)" and
  selecting anything else clears + sets cleanly. The server never
  auto-clears on disable — `enabled=0` is reversible, and
  `getPrimaryConnection` already filters `enabled !== 1`, so the
  strategy falls back to provider order until the user re-enables.
- If the pinned connection is **deleted**, the foreign-key cascade
  (`onDelete: "cascade"` on `service_connections.id`, see schema) drops
  the `primary_connections` row, so `GET /primary` simply does not
  return it — the picker shows "Auto" again with no warning surface.

## 6. Error handling

- `connection.not_found` → toast "Connection not found"; refetch primaries
  + connections.
- `connection.capability_unsupported` → toast "That provider doesn't
  support metadata"; refetch.
- 5xx → toast "Could not update primary provider"; optimistic rollback.

## 7. Tests

### Server

`apps/server/src/api/procedures/__tests__/connections-primary.test.ts`:

- Unauthenticated request → 401 (session middleware).
- Missing `ACCOUNT_CONNECTIONS` permission → 403.
- `POST` with foreign `connectionId` → 404 `connection.not_found`.
- `POST` with connection whose plugin doesn't advertise the capability →
  422 `connection.capability_unsupported`.
- `POST` happy path → row upserted, `invalidateUserCache` called.
- `POST` twice with different connectionIds → second wins (upsert
  semantics; this is the #458 fix regression test in API form).
- `DELETE` happy path → row removed, `invalidateUserCache` called.
- `DELETE` on non-existent row → 200 (idempotent).
- `GET` returns rows scoped to caller, sentinel `"_"` mapped to `null`.

### Strategy regression

`apps/server/src/media/__tests__/primary-with-enrichment.test.ts`
(existing — already in tree):

- Add case: with two providers `[A, B]` and `setPrimaryConnection` pinning
  the B-backed connection, `invokeAll` candidates are `[B, A]` (B first),
  proving the explicit primary moves to the front.

### Client

`apps/client/src/features/settings-connections/__tests__/primary-providers-card.test.tsx`:

- Card renders nothing when only 1 eligible connection per capability.
- Card renders both rows when ≥2 eligible exist for `metadata@v1`.
- Selecting a connection fires `POST /primary` with correct body.
- Selecting "Auto" fires `DELETE /primary`.
- Optimistic update: select rolls back on 5xx.
- Disabled connections do not appear in dropdown options.

## 8. Migration / Rollout

- No schema change. Table + service already exist.
- No feature flag. Behaviour change is opt-in: existing users see no
  difference until they touch the picker.
- Pre-stable repo (per project memory `project_breaking_changes_ok`), so no
  compat shims needed.

## 9. Open questions

None blocking. Listed for record:

- Should the `lastVerifiedAt` timestamp on `primary_connections` matter?
  Currently `updatedAt` only. No.
- Do we need an audit log of primary-provider changes? Not for v1.

## 10. References

- Issue #476 — this design.
- Issue #458 / PR `330b2189` — atomic upsert race fix (already merged).
- `apps/server/src/media/service/primary-preference.ts` — existing service.
- `apps/server/src/media/internal/strategies/primary-with-enrichment.ts` —
  strategy that reads the value.
- `apps/server/src/db/schema/preferences/user-preferences.ts` — schema.
