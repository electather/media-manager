# Plugin Advanced Admin Policy

**Status:** Draft for review
**Date:** 2026-04-24
**Author:** Omid Astaraki
**Companion:** `2026-04-19-plugin-architecture-design.md` (backend)
**Companion:** `2026-04-22-frontend-plugin-connections-design.md` (frontend)

## Summary

Admins currently have no way to shape a plugin's network behaviour after install. The plugin author's `manifest.allowedHosts` is the only gate, which is fine for first-party plugins but insufficient in two common deployment shapes: self-hosted plugins that declare `["*"]` to keep the manifest portable, and corporate environments where every outbound call must carry a gateway header or auth token.

This spec adds an **Advanced** section (admin-only) to every plugin on `/admin/plugins`, carrying two policies:

- **Admin host allowlist** — narrows the plugin author's `manifest.allowedHosts` via intersection. Only affects the static side; `x-allowed-host` (user-supplied URLs such as a user's Plex server) is unchanged.
- **Admin custom headers** — a global per-plugin `Record<string, string>` merged into every `ctx.fetch` call the plugin makes. Admin values override plugin-supplied values on conflict. Stored encrypted at rest, stripped from API responses.

Blocked-host attempts are recorded as a `warn`-level entry in the existing errors dashboard under a new code `plugin.host_blocked_by_admin` and surface to the plugin as the pre-existing `plugin.upstream_error` — no plugin needs to learn a new error shape.

The feature is intentionally small. Path-level restrictions, per-host header scoping, per-connection overrides, and aggregated violation widgets are deferred to future revisions.

## Goals

- Give admins a uniform way to tighten a plugin's network surface without touching plugin source or re-publishing manifests.
- Unblock self-hosted deployments whose plugins legitimately declare `manifest.allowedHosts: ["*"]` by letting the admin fill in the concrete allowlist at their site.
- Support corporate-gateway and custom-proxy deployments by letting admins inject auth / routing headers into every outbound call a plugin makes.
- Keep enforcement in one place (`ctx.fetch`) so policy is identical whether a call originates from capability dispatch, auth ceremony, job handler, `testConnection`, or `verifyShared`.
- Fail loudly: a blocked call produces an audit entry the admin can see.
- Zero regressions for existing deployments — all fields default to "inherit the manifest", matching current behaviour.

## Non-goals

- **Path/method restrictions** (e.g. "only GET under `/search`"). A future capability; this revision is host-only.
- **Per-host custom-header rules.** Global per-plugin only.
- **Per-connection overrides.** Admin policy lives on the plugin row, not on individual user connections.
- **User-facing plugin install UI** or admin-installable-plugin policy templates. Admins configure one plugin at a time.
- **Aggregated violation dashboards** (per-host counters, time-series). Violations flow through the existing errors dashboard and no new surface lands in this PR.
- **Bulk import / export of admin policy.** The two payloads are small; admins configure manually.
- **User-installable plugin restriction.** Built-ins and admin-installed plugins only, same as today.

## Background

The plugin runtime today exposes one network surface, `ctx.fetch`, built per-invocation in `packages/server/src/plugin-runtime/context.ts` and gated in `packages/server/src/plugin-runtime/fetch-policy.ts`. Two allowlist inputs merge into that gate:

- `manifest.allowedHosts: string[]` — author-declared. Supports `"*"`, exact hostnames, and `*.domain.com` wildcards via `isHostAllowed`.
- `dynamicAllowedHosts?: ReadonlySet<string>` — resolved per-invocation from `x-allowed-host` JSON Schema fields on `userConfigSchema` and `sharedCredentialsSchema`. The existing `allowed-hosts.ts` walker produces this set; the `isBlockedHostname` guard already refuses loopback, cloud IMDS, and link-local even when a user supplies them.

Both inputs are author-controlled at the manifest layer or user-controlled at the connection layer. There is no admin control surface. This spec adds exactly one admin input at the plugin level and threads it through the same `buildFetch` call site — no new runtime layers, no new context fields beyond what this spec introduces.

## Data model

Three nullable columns on `plugins` (`packages/server/src/db/schema/plugins.ts`):

```ts
export const plugins = sqliteTable("plugins", {
  // ...existing columns...
  adminAllowlist: text("admin_allowlist"), // JSON string[] | null
  adminHeadersEncrypted: text("admin_headers_encrypted"), // base64 ciphertext | null
  adminHeadersIv: text("admin_headers_iv"), // base64 iv | null
});
```

No new table. Adding columns matches how `globalConfig` and `personalKeyFallback` already sit on this row and avoids a join on every admin API load. If future advanced features require significantly more state (path rules, per-connection overrides) the columns can move into a `plugin_admin_policy` side table at that point; YAGNI until then.

### `adminAllowlist` semantics

- `null` — **inherit**. The plugin runs against `manifest.allowedHosts` exactly as today. This is the default after migration so existing deployments see no behaviour change.
- `[]` — admin has actively blocked every static host. The plugin can still reach any hostname resolved from `x-allowed-host` fields (user's Plex URL, Jellyfin URL). Legitimate for a deployment that only wants the user-side self-hosted path to work.
- `["api.trakt.tv", "*.tmdb.org", "*"]` — intersection candidates. Semantics match `manifest.allowedHosts`: exact hostnames, `*.domain.com` wildcards, bare `"*"`. A bare `"*"` in the admin list effectively means "allow everything the manifest already allows" — useful as an explicit acknowledgement rather than leaving the field `null`.

Validation at write time:

- Entries must be lowercase; UI and API lowercase on submit.
- Each entry is either `"*"`, a valid hostname, or `*.` followed by a valid hostname.
- Duplicates are rejected — the UI dedupes; the API returns `plugin.input_invalid`.
- No max length beyond a sane ceiling (64 entries) to keep the payload bounded.

### `adminHeaders` payload and encryption

Encrypted blob is a `Record<string, string>` — header names are case-insensitive per RFC 7230 but we store exactly what the admin typed; normalisation happens at fetch time via the `Headers` object.

Encryption reuses the existing AES-256-GCM helper that `plugin_shared_credentials` already uses (`packages/server/src/plugin-runtime/shared-credentials.ts`). Ciphertext and IV are stored as separate base64 columns, matching the `sharedCredentials` encoding. The plaintext map is never written to the database and never logged; the decrypted copy lives only in memory inside `buildContext` for the lifetime of a single `ctx.fetch` call chain.

Validation at write time:

- Header names must match `^[a-zA-Z0-9!#$%&'*+\-.^_\`|~]+$` (RFC 7230 token).
- Header values reject CR/LF characters (header-injection prevention).
- Reserved hop-by-hop headers (`Host`, `Content-Length`, `Transfer-Encoding`, `Connection`, `Upgrade`, `Keep-Alive`, `TE`, `Trailer`, `Proxy-Authorization`, `Proxy-Authenticate`) are rejected at write time — these are managed by the runtime and admin-overriding them breaks the transport.
- Empty-string values are rejected; the admin should delete the header instead (set to `null` on PUT).
- Max of 32 headers per plugin as a sanity ceiling.

## Runtime enforcement

Two small surgical changes under `packages/server/src/plugin-runtime`.

### Allowlist intersection — `fetch-policy.ts`

`buildFetch` signature gains a fourth parameter:

```ts
export function buildFetch(
  pluginId: string,
  allowedHosts: string[],
  dynamicHosts: ReadonlySet<string> | undefined,
  adminAllowlist: string[] | null,
  adminHeaders: Record<string, string> | undefined,
  errorSink: ErrorSink,
): (url: string, init?: RequestInit) => Promise<Response>;
```

The allowlist check becomes:

```ts
const inManifest = isHostAllowed(hostname, allowedHosts);
const inAdmin = adminAllowlist === null ? true : isHostAllowed(hostname, adminAllowlist);
const staticAllowed = inManifest && inAdmin;
const dynamicAllowed = dynamicHosts?.has(hostname.toLowerCase()) ?? false;

if (!staticAllowed && !dynamicAllowed) {
  // Distinguish admin-imposed blocks from manifest misses for audit.
  if (inManifest && !inAdmin) {
    errorSink.record("plugin.host_blocked_by_admin", {
      pluginId,
      hostname,
      severity: "warn",
    });
  }
  throw new PluginError(
    "plugin.upstream_error",
    `[${pluginId}] host not in allowlist: ${hostname}`,
  );
}
```

The plugin-visible error shape and code are identical to today. The only behaviour change a plugin can observe is that a host which was previously allowed now raises `plugin.upstream_error` — plugins already treat that code as a terminal call failure, so no plugin needs changes.

Dynamic hosts (`x-allowed-host`) bypass the admin-allowlist check entirely by design. The admin's control surface is for the plugin author's static declarations; user-supplied URLs remain the user's responsibility, still gated by `isBlockedHostname` against loopback, IMDS, and link-local ranges. This keeps a single source of truth at the fetch level and sidesteps the UX problem of admins having to predict every user's LAN hostnames.

### Header injection — `fetch-policy.ts`

After the allowlist check passes and the rate-limiter takes a token, admin headers are merged into the request:

```ts
const hdrs = new Headers(init?.headers);
if (adminHeaders) {
  for (const [name, value] of Object.entries(adminHeaders)) hdrs.set(name, value); // admin wins
}
return fetch(url, { ...init, headers: hdrs });
```

`Headers.set` is case-insensitive, so admin-wins is uniform regardless of the casing a plugin used for the same header. The merge only runs when `adminHeaders` is populated; plugins whose admin has configured nothing see the exact same request they emit today.

Admin header values are never logged — the fetch-policy logger emits only hostname and plugin id on a rejection; successful calls are not logged at all.

### Context wiring — `context.ts`

`BuildContextArgs` gains:

```ts
interface BuildContextArgs {
  // ...existing fields...
  adminAllowlist?: string[] | null; // null = inherit
  adminHeaders?: Record<string, string>; // undefined = none
}
```

`buildContext` threads both into `buildFetch`. Call sites that don't have an active plugin row (unreachable today — context is always built for a known plugin) receive `null` / `undefined` defaults which preserve current behaviour.

### Aux contexts — auth, jobs, `testConnection`, `verifyShared`

Every site that builds a `PluginContext` loads the admin policy from the `plugins` row alongside the existing manifest load. This keeps policy enforcement uniform — a `testConnection` that would fail under the admin policy must fail there too, not silently pass and then break at capability call time. Sites covered:

- `pluginRuntime.invokeCapability` — capability dispatch (the common path).
- `pluginRuntime.testConnection` / `pluginRuntime.testSharedCredential` — admin UI test buttons.
- `pluginRuntime.startAuth` / `completeAuth` / `pollAuth` / `refreshAuth` — the auth ceremony.
- Plugin job handlers — croner-scheduled work.
- Any host-tool path that reaches into a plugin (e.g. media-service MCP tools).

All of these already call `buildContext` via the runtime; each gets the two new fields passed through from a single `loadPluginPolicy(pluginId)` helper that returns `{ adminAllowlist, adminHeaders }` after decrypting the headers blob.

### Decryption caching

Decrypting the admin-headers blob on every `buildContext` call would be wasteful. The runtime caches the decrypted headers per `pluginId` behind the existing per-plugin manifest cache, invalidating the entry on any write to `admin_headers_*` columns via the same cache-invalidation hook the runtime uses for manifest reloads. Allowlist values are plaintext and read directly with the manifest.

### Error sink integration

`plugin.host_blocked_by_admin` joins `HOST_ERROR_CODES` (see `packages/server/src/errors/codes.ts`) at severity `warn`. The `ErrorSink` already routes host errors to the `errors` table and the admin errors dashboard; the only new work is the code enum entry and a short display label on the dashboard side (`"Host blocked by admin policy"`).

The plugin-facing error is always `plugin.upstream_error` so a plugin author has exactly one code to handle for "host denied". The two-code split (audit vs plugin-facing) is deliberate — plugins do not need to distinguish author-declared miss from admin-imposed block, and exposing the distinction to plugin code would be a surface area increase for no benefit.

## API surface

All endpoints live under `pluginsApp` in `packages/server/src/api/procedures/plugins.ts` and run under the existing `requirePermission(PERMISSIONS.ADMIN_PLUGINS)` middleware.

### Extended `PluginRow`

`GET /api/plugins/` is extended — each row gains:

```ts
advanced: {
  adminAllowlist: string[] | null;    // null = inherit manifest
  adminHeaderNames: string[];         // header names only; values never returned
};
```

Header values are never surfaced in any API response. The frontend renders the names table with `••••` placeholders and relies on the edit flow to re-submit values.

### `PUT /api/plugins/:id/admin-allowlist`

```ts
Body: { allowlist: string[] | null }
Response: { ok: true } | typed error
```

- `null` clears the override; the plugin reverts to manifest-only.
- Array is validated per the rules in _Data model_. Lowercasing is done server-side.
- Duplicate entries, invalid hostnames, or a length above 64 return `plugin.input_invalid`.
- Successful write invalidates the per-plugin policy cache; next `buildContext` call reloads.

### `GET /api/plugins/:id/admin-headers`

```ts
Response: { names: string[] }
```

Names only; no values. This is redundant with the `PluginRow.advanced.adminHeaderNames` field but useful as a dedicated fetch when the admin dialog opens without re-listing every plugin.

### `PUT /api/plugins/:id/admin-headers`

```ts
Body: { headers: Record<string, string | null> }
Response: { ok: true } | typed error
```

Merge semantics mirror the `x-secret` pattern the connection modal already uses:

- **Omitted keys** — preserved at their existing values. The client sends only the names it wants to touch.
- **Value is a string** — sets or replaces that header.
- **Value is `null`** — deletes the header.
- **Empty map `{}`** — no-op (same as sending nothing).

To fully clear, the UI sends `null` for every existing name. There is no `replace: true` flag in v1 — the pattern above covers every realistic case.

Validation rules from _Data model_ apply; violations return `plugin.input_invalid` and the blob is not re-encrypted or written.

### No ephemeral test endpoint

The admin allowlist and headers only take effect through `ctx.fetch`; the existing `POST /api/plugins/:id/shared-credentials/:credId/test` and per-connection "test" button already run through that code path. Saving the policy then clicking test is the verification flow. Adding an ephemeral-test endpoint for admin policy would double the surface with no extra signal.

## Violation logging

New error code added to `packages/server/src/errors/codes.ts`:

```ts
export const HOST_ERROR_CODES = [
  // ...existing codes...
  "plugin.host_blocked_by_admin",
] as const;
```

Routed through the existing `ErrorSink`. Entry payload:

```ts
{
  code: "plugin.host_blocked_by_admin",
  severity: "warn",
  pluginId: string,
  hostname: string,
  timestamp: number,
  // capabilityId / jobId / authPhase optionally provided by the caller that
  // invokes buildContext, so the dashboard can show WHICH plugin surface
  // tried to reach the blocked host. Not required; the code and hostname are
  // enough to drive a warning row.
}
```

Surfaces on the existing admin errors dashboard as a standard host-error entry, same shape as `plugin.upstream_error` today. No new UI in this PR. A later revision can add a "recent admin-policy violations for this plugin" widget on the plugin card; the data is already there.

Rate at which this log can fire is bounded by the existing fetch-policy rate limiter — a runaway plugin cannot spam the errors table with blocked-host entries any faster than it can spam anything else.

## Frontend

Admin-only. User-facing surfaces are untouched: `PluginSummary` returned to `/connections` carries nothing from the admin policy.

### `<AdvancedSection>` component

Lives in `packages/client/src/routes/_authenticated/admin/plugins.tsx`, rendered inside each plugin card as a shadcn `Collapsible` at the bottom of the card body, below the existing shared-credentials table and `personalKeyFallback` control. Closed by default — most admins will never open it.

The collapsible header shows:

- Label: `Advanced`.
- Badge count: number of configured restrictions (allowlist-set bit + header count). Hidden when both are defaults.
- Chevron toggle.

Two sub-panels stacked inside the open state. No nested collapsibles.

### Sub-panel 1 — Host allowlist override

Layout:

- Read-only "Manifest allowlist" list at the top: the plugin's declared `manifest.allowedHosts`, muted chips.
- Radio group:
  - `Inherit manifest (default)` — selected when `adminAllowlist === null`.
  - `Restrict to:` — when selected, enables the admin-list editor below.
- Admin-list editor: shadcn chip input with validation on blur (lowercase, hostname or wildcard pattern). `Save` button disabled while the editor is invalid.
- Warning banner when the resulting intersection is empty (admin allowlist has no overlap with `manifest.allowedHosts`): `"Plugin will make no network calls with this configuration. User-supplied server URLs (x-allowed-host) are unaffected."`

Submit path:

- Switching the radio to `Inherit manifest` PUTs `{ allowlist: null }`.
- Saving the admin list PUTs `{ allowlist: [...] }`.

Copy on the panel header explains what the override does in one sentence, linking to this design doc.

### Sub-panel 2 — Custom headers

Layout:

- Table of header names with actions:
  | Name | Value | |
  |-------------|---------|--------------|
  | `X-Corp-Key`| `••••` | Edit / Delete|
  | `X-Env` | `••••` | Edit / Delete|
- `Add header` button opens a dialog taking `{ name, value }`.
- Edit dialog:
  - `Name` — read-only on edit (changing name would leak the old key; admins delete + re-add).
  - `Value` — masked input, empty on open, with a `Preserve existing value` checkbox checked by default. Unchecking enables the input; leaving it checked drives an omission on PUT (preserves prior value).

Submit path:

- Add: PUT `{ headers: { [name]: value } }` — merge adds a key.
- Edit with `Preserve existing value` checked and no other fields changed: no request fired (no-op save).
- Edit with a new value: PUT `{ headers: { [name]: value } }`.
- Delete: PUT `{ headers: { [name]: null } }`.

Masking and merge behaviour match the existing connection modal for `x-secret` fields so admins already know the pattern.

Warning banner when the admin configures a common auth header (`Authorization`, `Proxy-Authorization`, `X-Api-Key`) but the plugin's `manifest.auth.kind !== "none"`: `"This plugin ships its own auth; the admin header will override the plugin's header on every request. Confirm this is intended."` The write still goes through — this is a heads-up, not a block.

### Type inference

Follows the pattern already locked in by `docs/2026-04-22-frontend-plugin-connections-design.md`: the new `advanced` field on `PluginRow` is inferred via `InferResponseType<typeof api.plugins.$get>`. No hand-written type; the Hono client is the source of truth.

### Permission gating

The component only renders on `/admin/plugins`, which is already gated by the admin role. No extra frontend permission check; the API-level `ADMIN_PLUGINS` gate is authoritative.

## Testing plan

### Server — runtime

- `fetch-policy.test.ts` — intersection cases: `null` (inherit), `[]` (block all static), concrete list narrowing, `*.foo.com` admin entry narrowing an exact manifest entry, bare `"*"` admin entry as a no-op.
- `fetch-policy.test.ts` — admin-block path emits `plugin.host_blocked_by_admin` to the error sink _and_ throws `plugin.upstream_error` to the plugin. Manifest-miss path emits no admin-block log.
- `fetch-policy.test.ts` — dynamic hosts (`x-allowed-host`) remain reachable when admin allowlist is set to `[]`, confirming the admin rule does not gate user-supplied URLs.
- `fetch-policy.test.ts` — admin headers merged into `init.headers`; admin `Authorization` overrides plugin `Authorization` regardless of casing; empty / undefined `adminHeaders` leaves `init.headers` untouched.
- `fetch-policy.test.ts` — admin header values are not logged on rejection.
- `runtime-allowed-hosts.test.ts` — existing dynamic-host resolution tests extended to pass an admin allowlist through and confirm no interference.
- `context.test.ts` — `buildContext` threads the two new args into `buildFetch`; auth and job contexts pick them up too.
- New `admin-policy.test.ts` — `loadPluginPolicy` cache hit/miss, invalidation on write.

### Server — API

- `procedures/plugins.test.ts` — `PUT /admin-allowlist` validation (lowercase, hostname shape, `null`, dedupe, length ceiling).
- `procedures/plugins.test.ts` — `PUT /admin-headers` merge semantics (omit preserves, `null` deletes, new value replaces, empty map is no-op), validation (name pattern, CR/LF rejection, reserved-header rejection, ceiling).
- `procedures/plugins.test.ts` — `GET /` response includes `advanced.adminAllowlist` and `advanced.adminHeaderNames` but no header values.
- `procedures/plugins.test.ts` — non-admin session is rejected on every new endpoint.

### Server — end-to-end

- Contract test against the Trakt plugin: set admin allowlist to `["example.com"]`, invoke `watchHistory@v1`, confirm the plugin call fails with `plugin.upstream_error` and an `errors` row lands with code `plugin.host_blocked_by_admin`.
- Contract test: set admin headers to `{ "X-Corp-Key": "abc" }`, invoke any capability, confirm the upstream fetch sees `X-Corp-Key: abc` (via a test fetch spy).

### Client

- Component test for `<AdvancedSection>` in each of its states (inherit, restricted, headers-populated, empty-intersection warning, reserved-header warning).
- Snapshot / interaction test for the add / edit / delete flow with the `Preserve existing value` checkbox.

### Manual verification checklist

- Against a running dev server:
  1. Enable Trakt plugin; confirm a `/connections` call succeeds.
  2. On `/admin/plugins`, open the Trakt card's Advanced section, restrict allowlist to `["example.com"]`, save.
  3. Trigger a Trakt capability call; expect a plugin error surfaced via the usual route.
  4. Check the admin errors dashboard; expect a `plugin.host_blocked_by_admin` row with `hostname: api.trakt.tv`.
  5. Revert the allowlist to Inherit; call succeeds.
  6. Add admin header `{ "X-Test": "abc" }`, capture outbound traffic with a proxy, confirm the header on every Trakt request.

## Migration

- Drizzle migration adds three nullable columns to `plugins` with defaults `null`. No backfill — inheriting the manifest is the existing behaviour and every new row starts there.
- `@ent-mcp/shared` gains Zod schemas for the new API payloads alongside the existing `plugin*Schema` exports.
- `@ent-mcp/client` picks up the new `PluginRow.advanced` shape via `InferResponseType`; no client-side migration beyond rendering the new section.
- No changeset bump is strictly required for a docs-only PR, but the implementation PRs that follow this doc will bump `@ent-mcp/server` (minor — new capability) and `@ent-mcp/client` (minor — new UI). Neither is a breaking change; existing deployments see identical runtime behaviour until an admin opts in.
- No rollback considerations beyond reverting the columns — since `null` means "inherit manifest", a rollback that drops the columns drops the feature without affecting already-configured plugins in any active way.

## Open questions

- **Audit retention.** How long do `plugin.host_blocked_by_admin` rows live? The existing errors table already has a retention policy; this code inherits it. If admins want longer-lived audit logs, that's a separate revision of the error management design — out of scope here.
- **DNS rebinding.** The admin allowlist is a hostname string match. An attacker controlling a domain the admin allows could still pin it to an internal IP at fetch time. This is an existing runtime concern called out in `allowed-hosts.ts` (`"DNS-rebinding mitigation still has to happen at fetch time and is tracked separately"`). The admin policy does not make this worse; fixing it is tracked against the broader SSRF hardening work.
- **Header templating.** Not in v1. If we need dynamic values (per-request nonces, short-lived tokens) a future revision adds a `${env.VAR_NAME}` syntax. Plain strings cover the common corporate-gateway case.

## Out of scope for this PR (tracked for future work)

- Path/method restrictions on the admin allowlist (Tradeoff 1 Option C in the brainstorm).
- Per-host header scoping (Tradeoff 2 Option B in the brainstorm).
- Admin-visible aggregated violation dashboard per plugin.
- Bulk import/export of admin policy.
- Header templating / dynamic values.
