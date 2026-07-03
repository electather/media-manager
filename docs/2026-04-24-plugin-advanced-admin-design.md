# Plugin Advanced Admin Policy

**Status:** Draft for review
**Date:** 2026-04-24
**Author:** Omid Astaraki
**Companion:** `2026-04-19-plugin-architecture-design.md` (backend)
**Companion:** `2026-04-22-frontend-plugin-connections-design.md` (frontend)
**Related:** `2026-06-29-plugin-bundled-default-credential-design.md` (read-only "Bundled" row in shared-credentials table)

## Summary

⊥ admin control over plugin network behavior post-install. `manifest.allowedHosts` sole gate — insufficient for:

- Self-hosted plugins w/ `["*"]` manifest (portable but unconstrained).
- Corporate envs requiring gateway headers on every outbound call.

Spec adds **Advanced** collapsible (admin-only) per plugin on `/admin/plugins`:

- **Admin host allowlist** — intersection w/ `manifest.allowedHosts`. Static only; `x-allowed-host` (user-supplied URLs) unaffected.
- **Admin custom headers** — `Record<string, string>` merged into every `ctx.fetch`. Admin wins on conflict. Encrypted at rest. ⊥ returned in API responses.

Blocked attempts → `warn` entry in errors dashboard, code `plugin.host_blocked_by_admin`. Plugin sees pre-existing `plugin.upstream_error` — ⊥ new error shape for plugins.

Intentionally small. Path restrictions, per-host header scoping, per-connection overrides, violation widgets → deferred.

## Goals

- V1: Admin tighten plugin network surface ∴ ⊥ plugin source changes needed.
- V2: Unblock self-hosted `manifest.allowedHosts: ["*"]` → admin fills concrete allowlist.
- V3: Support corporate-gateway/proxy → admin inject headers on every outbound call.
- V4: Enforcement single point (`ctx.fetch`) → uniform policy across capability dispatch, auth, jobs, `testConnection`, `verifyShared`.
- V5: Blocked call → audit entry visible to admin.
- V6: ∀ existing deployments → ⊥ behavior change; defaults inherit manifest.

## Non-goals

- Path/method restrictions (e.g. GET-only under `/search`) — future.
- Per-host custom-header rules — global per-plugin only.
- Per-connection overrides — policy on plugin row, ∉ individual connections.
- User-facing install UI | admin policy templates.
- Aggregated violation dashboards — flows through existing errors dashboard, ⊥ new surface this PR.
- Bulk import/export of admin policy.
- User-installable plugin restriction — built-ins & admin-installed only, same as today.

## Background

Plugin runtime exposes one network surface: `ctx.fetch`. Built per-invocation in `packages/server/src/plugin-runtime/context.ts`, gated in `packages/server/src/plugin-runtime/fetch-policy.ts`. Two allowlist inputs merge into gate:

- `manifest.allowedHosts: string[]` — author-declared. Supports `"*"`, exact hostnames, `*.domain.com` wildcards via `isHostAllowed`.
- `dynamicAllowedHosts?: ReadonlySet<string>` — resolved per-invocation from `x-allowed-host` JSON Schema fields on `userConfigSchema`, `sharedCredentialsSchema` & `globalConfigSchema`. `allowed-hosts.ts` walker produces set; `isBlockedHostname` already refuses loopback, cloud IMDS, link-local even from user input.

Both inputs: author-controlled (manifest) | user-controlled (connection). ⊥ admin control surface. Spec adds exactly one admin input at plugin level, threads through same `buildFetch` call site — ⊥ new runtime layers.

## Data model

3 nullable columns on `plugins` (`packages/server/src/db/schema/plugins.ts`):

```ts
export const plugins = sqliteTable("plugins", {
  // ...existing columns...
  adminAllowlist: text("admin_allowlist"), // JSON string[] | null
  adminHeadersEncrypted: text("admin_headers_encrypted"), // base64 ciphertext | null
  adminHeadersIv: text("admin_headers_iv"), // base64 iv | null
});
```

⊥ new table. Columns match how `globalConfig` & `personalKeyFallback` already sit on row — avoids join on every admin API load.

### `adminAllowlist` semantics

- `null` → **inherit**. Plugin runs against `manifest.allowedHosts` exactly as today. Default after migration — ⊥ behavior change for existing deployments.
- `[]` → admin blocked every static host. Plugin still reaches hostnames from `x-allowed-host` (user's Plex URL, Jellyfin URL). Dynamic hosts bypass admin allowlist by design.

  > `adminAllowlist: []` ≠ "plugin makes no outbound calls." `x-allowed-host` fields bypass entirely. Admin must also control what users enter into connection forms. UI banner warns when static intersection empty.

- `["api.trakt.tv", "*.tmdb.org", "*"]` → intersection candidates. Semantics match `manifest.allowedHosts`. Bare `"*"` = allow everything manifest allows — explicit acknowledgement vs `null`.

Validation on write:

- Entries lowercase. UI & API lowercase on submit.
- Entry ∈ `"*"` | valid hostname | `*.` + valid hostname.
- Duplicates → `plugin.input_invalid`. UI dedupes; API rejects.
- Max 64 entries.

### `adminHeaders` payload & encryption

Encrypted blob = `Record<string, string>`. Names case-insensitive per RFC 7230; stored as typed; normalised at fetch time via `Headers` object.

Encryption reuses AES-256-GCM helper from `plugin_shared_credentials` (`packages/server/src/plugin-runtime/shared-credentials.ts`). Ciphertext & IV stored as separate base64 columns, matching `sharedCredentials` encoding. Plaintext ⊥ written to DB, ⊥ logged; decrypted copy lives only in memory inside `buildContext` for lifetime of single `ctx.fetch` call chain.

Validation on write:

- Header names must match `^[a-zA-Z0-9!#$%&'*+\-.^_\`|~]+$` (RFC 7230 token).
- Values reject CR/LF (header-injection prevention).
- Reserved hop-by-hop headers (`Host`, `Content-Length`, `Transfer-Encoding`, `Connection`, `Upgrade`, `Keep-Alive`, `TE`, `Trailer`, `Proxy-Authorization`, `Proxy-Authenticate`) → rejected. Runtime manages these.
- Empty-string values → rejected; admin deletes instead (`null` on PUT).
- Max 32 headers per plugin.

## Runtime enforcement

2 surgical changes under `packages/server/src/plugin-runtime`.

### Allowlist intersection — `fetch-policy.ts`

`buildFetch` gains 2 params (`adminAllowlist`, `adminHeaders`):

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

Allowlist check:

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

Plugin-visible error shape & code identical to today. `x-allowed-host` dynamic hosts bypass admin allowlist by design — admin controls static declarations; user-supplied URLs gated by `isBlockedHostname` (loopback, IMDS, link-local) only.

### Header injection — `fetch-policy.ts`

After allowlist check passes & rate-limiter takes token:

```ts
const hdrs = new Headers(init?.headers);
if (adminHeaders && staticAllowed) {
  for (const [name, value] of Object.entries(adminHeaders)) hdrs.set(name, value); // admin wins
}
return fetch(url, { ...init, headers: hdrs });
```

`Headers.set` case-insensitive → admin-wins uniform regardless of casing. Merge only runs when `adminHeaders` populated **and** the host matched the static allowlist — dynamic hosts (user-supplied via `x-allowed-host`) never receive admin credentials. Admin header values ⊥ logged.

### Context wiring — `context.ts`

`BuildContextArgs` gains:

```ts
interface BuildContextArgs {
  // ...existing fields...
  adminAllowlist?: string[] | null; // null = inherit
  adminHeaders?: Record<string, string>; // undefined = none
}
```

`buildContext` threads both into `buildFetch`. ⊥ active plugin row (unreachable today) → `null`/`undefined` defaults preserve current behavior.

### Aux contexts — auth, jobs, `testConnection`, `verifyShared`

∀ sites building `PluginContext` → load admin policy from `plugins` row alongside manifest load. `testConnection` failing under admin policy must fail there too, ⊥ silently pass then break at capability call time.

Sites covered:

- `pluginRuntime.invokeCapability` — capability dispatch (common path).
- `pluginRuntime.testConnection` / `pluginRuntime.testSharedCredential` — admin UI test buttons.
- `pluginRuntime.startAuth` / `completeAuth` / `pollAuth` / `refreshAuth` — auth ceremony.
- Plugin job handlers — croner-scheduled work.
- Host-tool paths into plugins (e.g. media-service MCP tools).

All reach `buildContext` via runtime; each gets 2 new fields via single `loadPluginPolicy(pluginId)` helper returning `{ adminAllowlist, adminHeaders }` after decrypting headers blob.

### Decryption caching

Decrypt admin-headers blob on every `buildContext` → wasteful. Runtime caches decrypted headers per `pluginId` behind existing per-plugin manifest cache. Invalidates on write to `admin_headers_*` columns via same cache-invalidation hook as manifest reloads. Allowlist plaintext → read directly w/ manifest.

### Error sink integration

`plugin.host_blocked_by_admin` joins `HOST_ERROR_CODES` (`packages/server/src/errors/codes.ts`) at severity `warn`. `ErrorSink` already routes host errors to `errors` table & admin errors dashboard. New work: code enum entry + short display label (`"Host blocked by admin policy"`).

Plugin-facing error always `plugin.upstream_error` — ⊥ new code for plugin to handle. Two-code split (audit vs plugin-facing) deliberate: plugins ∉ distinguish author-declared miss from admin-imposed block.

## API surface

∀ endpoints live under `pluginsApp` in `packages/server/src/api/procedures/plugins.ts`. Run under existing `requirePermission(PERMISSIONS.ADMIN_PLUGINS)` middleware.

### Extended `PluginRow`

`GET /api/plugins/` extended — each row gains:

```ts
advanced: {
  adminAllowlist: string[] | null;    // null = inherit manifest
  adminHeaderNames: string[];         // header names only; values ⊥ returned
};
```

Header values ⊥ surfaced in any API response. Frontend renders names table w/ `••••` placeholders; edit flow re-submits values.

### `PUT /api/plugins/:id/admin-allowlist`

```ts
Body: { allowlist: string[] | null }
Response: { ok: true } | typed error
```

- `null` → clear override; plugin reverts to manifest-only.
- Array validated per §Data model. Lowercased server-side.
- Duplicate entries | invalid hostnames | length > 64 → `plugin.input_invalid`.
- Successful write invalidates per-plugin policy cache.

### `PUT /api/plugins/:id/admin-headers`

```ts
Body: { headers: Record<string, string | null> }
Response: { ok: true } | typed error
```

Merge semantics mirror `x-secret` pattern in connection modal:

- **Omitted keys** — preserved. Client sends only names to touch.
- **Value = string** — set | replace.
- **Value = `null`** — delete.
- **Empty map `{}`** — no-op.

Full clear: UI sends `null` for every existing name. ⊥ `replace: true` flag in v1. §Data model validations apply.

### No ephemeral test endpoint

Admin allowlist & headers only take effect through `ctx.fetch`; existing test buttons already run through that code path. Save policy → click test = verification flow. Ephemeral-test endpoint doubles surface ∀ ⊥ extra signal.

## Violation logging

New error code in `packages/server/src/errors/codes.ts`:

```ts
export const HOST_ERROR_CODES = [
  // ...existing codes...
  "plugin.host_blocked_by_admin",
] as const;
```

Routed through existing `ErrorSink`. Entry payload:

```ts
{
  code: "plugin.host_blocked_by_admin",
  severity: "warn",
  pluginId: string,
  hostname: string,
  timestamp: number,
  // capabilityId / jobId / authPhase optionally provided by caller;
  // not required — code & hostname enough for warning row.
}
```

Surfaces on existing admin errors dashboard — same shape as `plugin.upstream_error` today. ⊥ new UI this PR. Per-plugin violation widget → future revision; data already there.

Rate bounded by existing fetch-policy rate limiter — runaway plugin ⊥ spam errors table faster than anything else.

## Frontend

Admin-only. User-facing surfaces untouched: `PluginSummary` to `/connections` carries ⊥ admin policy.

### `<AdvancedSection>` component

Lives in `packages/client/src/routes/_authenticated/admin/plugins.tsx`. Rendered inside each plugin card as shadcn `Collapsible` at bottom of card body, below shared-credentials table & `personalKeyFallback` control. Closed by default.

Collapsible header:

- Label: `Advanced`.
- Badge count: # configured restrictions (allowlist-set bit + header count). Hidden when both default.
- Chevron toggle.

2 sub-panels stacked in open state. ⊥ nested collapsibles.

### Sub-panel 1 — Host allowlist override

Layout:

- Read-only "Manifest allowlist": `manifest.allowedHosts` muted chips.
- Radio group:
  - `Inherit manifest (default)` — when `adminAllowlist === null`.
  - `Restrict to:` — enables admin-list editor below.
- Admin-list editor: shadcn chip input w/ blur validation (lowercase, hostname | wildcard). `Save` disabled while invalid.
- Warning banner when intersection empty: `"Plugin will make no network calls with this configuration. User-supplied server URLs (x-allowed-host) are unaffected."`

Submit path:

- Radio → `Inherit manifest` → PUT `{ allowlist: null }`.
- Save admin list → PUT `{ allowlist: [...] }`.

### Sub-panel 2 — Custom headers

Layout:

- Table of header names:
  | Name | Value | |
  |-------------|---------|--------------|
  | `X-Corp-Key`| `••••` | Edit / Delete|
  | `X-Env` | `••••` | Edit / Delete|
- `Add header` → dialog `{ name, value }`.
- Edit dialog:
  - `Name` — read-only on edit (change name → delete + re-add).
  - `Value` — masked input, empty on open. `Preserve existing value` checkbox (default: checked). Uncheck enables input; checked → omission on PUT.

Submit path:

- Add: PUT `{ headers: { [name]: value } }`.
- Edit w/ preserve checked & ⊥ other changes: ⊥ request fired.
- Edit w/ new value: PUT `{ headers: { [name]: value } }`.
- Delete: PUT `{ headers: { [name]: null } }`.

Warning banner when admin configures common auth header (`Authorization`, `Proxy-Authorization`, `X-Api-Key`) & `manifest.auth.kind !== "none"`: `"This plugin ships its own auth; the admin header will override the plugin's header on every request. Confirm this is intended."` Write proceeds — heads-up ⊥ block.

### Type inference

Follows pattern from `docs/2026-04-22-frontend-plugin-connections-design.md`: `advanced` on `PluginRow` inferred via `InferResponseType<typeof api.plugins.$get>`. ⊥ hand-written type. Hono client source of truth.

### Permission gating

Component only renders on `/admin/plugins` (admin role gated). ⊥ extra frontend permission check; `ADMIN_PLUGINS` gate at API level authoritative.

## Testing plan

### Server — runtime

- `fetch-policy.test.ts` — intersection: `null` (inherit), `[]` (block all static), concrete list narrowing, `*.foo.com` admin entry narrowing exact manifest entry, bare `"*"` as no-op.
- `fetch-policy.test.ts` — admin-block path emits `plugin.host_blocked_by_admin` to sink & throws `plugin.upstream_error`. Manifest-miss path ⊥ emit admin-block log.
- `fetch-policy.test.ts` — dynamic hosts (`x-allowed-host`) reachable when `adminAllowlist: []`; admin rule ⊥ gate user-supplied URLs.
- `fetch-policy.test.ts` — admin headers merged into `init.headers`; admin `Authorization` overrides plugin `Authorization` regardless of casing; empty/undefined `adminHeaders` leaves `init.headers` untouched.
- `fetch-policy.test.ts` — admin header values ⊥ logged on rejection.
- `runtime-allowed-hosts.test.ts` — existing dynamic-host tests extended w/ admin allowlist; ⊥ interference confirmed.
- `context.test.ts` — `buildContext` threads 2 new args into `buildFetch`; auth & job contexts pick them up.
- `admin-policy.test.ts` — `loadPluginPolicy` cache hit/miss, invalidation on write.

### Server — API

- `procedures/plugins.test.ts` — `PUT /admin-allowlist` validation (lowercase, hostname shape, `null`, dedupe, length ceiling).
- `procedures/plugins.test.ts` — `PUT /admin-headers` merge (omit preserves, `null` deletes, new value replaces, `{}` no-op), validation (name pattern, CR/LF rejection, reserved-header rejection, ceiling).
- `procedures/plugins.test.ts` — `GET /` includes `advanced.adminAllowlist` & `advanced.adminHeaderNames` ∉ header values.
- `procedures/plugins.test.ts` — non-admin session rejected on every new endpoint.

### Server — E2E

- Contract test vs Trakt plugin: set `adminAllowlist` to `["example.com"]`, invoke `watchHistory@v1`, confirm `plugin.upstream_error` & `errors` row w/ code `plugin.host_blocked_by_admin`.
- Contract test: set `adminHeaders` to `{ "X-Corp-Key": "abc" }`, invoke capability, confirm upstream fetch sees `X-Corp-Key: abc` via fetch spy.

### Client

- Component test for `<AdvancedSection>` in each state (inherit, restricted, headers-populated, empty-intersection warning, reserved-header warning).
- Snapshot/interaction test for add/edit/delete flow w/ `Preserve existing value` checkbox.

### Manual verification checklist

1. Enable Trakt plugin; confirm `/connections` call succeeds.
2. On `/admin/plugins`, open Trakt card Advanced section, restrict allowlist to `["example.com"]`, save.
3. Trigger Trakt capability; expect plugin error via usual route.
4. Check admin errors dashboard; expect `plugin.host_blocked_by_admin` row w/ `hostname: api.trakt.tv`.
5. Revert allowlist to Inherit; call succeeds.
6. Add admin header `{ "X-Test": "abc" }`, capture outbound traffic w/ proxy, confirm header on every Trakt request.

## Migration

- Drizzle migration adds 3 nullable columns to `plugins` w/ defaults `null`. ⊥ backfill — inheriting manifest = existing behavior; ∀ new rows start there.
- `@nama/shared` gains Zod schemas for new API payloads alongside existing `plugin*Schema` exports.
- `@nama/client` picks up `PluginRow.advanced` via `InferResponseType`; ⊥ client-side migration beyond rendering new section.
- ⊥ changeset bump required for docs-only PR. Implementation PRs: `@nama/server` minor (new capability), `@nama/client` minor (new UI). ⊥ breaking changes; existing deployments see identical runtime behavior until admin opts in.
- Rollback requires dedicated Drizzle down-migration. SQLite < 3.35 ⊥ `ALTER TABLE … DROP COLUMN`; Drizzle handles via table recreation. Plugins w/ admin policy configured → policy lost on rollback; ∉ affect runtime behavior of already-running deployments.

## Open questions

- **Audit retention.** `plugin.host_blocked_by_admin` row lifespan? Inherits existing errors table retention policy. Longer-lived audit logs → separate revision of error management design; ⊥ scope here.
- **DNS rebinding.** Admin allowlist = hostname string match. Attacker controlling allowed domain could pin to internal IP at fetch time. Existing runtime concern noted in `allowed-hosts.ts`. Admin policy ∉ make worse. Mitigated in PR #1003: `ctx.fetch` resolves every A/AAAA record + rejects blocked addresses before connect. Residual TOCTOU (fetch re-resolves) → issue #1036 (IP-pinned dispatcher).
- **Header templating.** ⊥ v1. Dynamic values (per-request nonces, short-lived tokens) → future revision adds `${env.VAR_NAME}` syntax. Plain strings cover corporate-gateway case.
- **Encryption-key rotation.** `admin_headers_encrypted`/`admin_headers_iv` encrypted w/ app's AES-256-GCM key (same scheme as `plugin_shared_credentials`). Key rotation → existing blobs fail to decrypt until re-encrypted. Does existing key-rotation path for `shared_credentials` handle re-encryption pass over `plugins` table? If yes → defer; if no → implementation PR needs migration or runbook.

## Out of scope (future work)

- Path/method restrictions on admin allowlist.
- Per-host header scoping.
- Admin-visible aggregated violation dashboard per plugin.
- Bulk import/export of admin policy.
- Header templating / dynamic values.
- `GET /api/plugins/:id/admin-headers` dedicated endpoint — `PluginRow.advanced.adminHeaderNames` already carries data on every plugin list response.
