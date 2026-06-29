# Plugin Bundled Default Shared Credential — Design

- **Date:** 2026-06-29
- **Status:** Draft for review
- **Author:** Omid Astaraki
- **Related:**
  - `docs/2026-04-19-plugin-architecture-design.md` (manifest, credential plan, shared-cred pool)
  - `docs/2026-04-24-plugin-advanced-admin-design.md` (shared-credentials table UI)
  - `docs/2026-06-14-admin-onboarding-first-install-design.md` (onboarding step, `tmdbConfigured`)

## Summary

Built-in plugin ship **bundled default shared credential** baked in source. Zero admin config → plugin work out-of-box (posters fetch during onboarding before any key entered). Surfaces read-only "Bundled" row in admin creds list. Always lowest priority — any admin/user key override. Generic: any built-in opt in via one manifest field. First consumer: TMDB. Pattern mirror seerr upstream (single embedded TMDB v3 key, no proxy, no user key).

## Goals

- Built-in declare baked default shared cred. Plugin usable with ⊥ admin action.
- Onboarding TMDB step → **optional**: bundled key satisfy `tmdbConfigured`; admin still override.
- Bundled cred visible **read-only** in creds list. Admin-added key take priority.
- Generic mechanism (manifest field), ⊥ TMDB-special-case. "certain plugins configured by default."

## Non-goals (deferred — YAGNI)

- Env-var override of bundled key (`NAMA_TMDB_DEFAULT_KEY`). Single source-baked const only.
- Bootstrap DB seeding / real `plugin_shared_credentials` row for bundled key.
- Install-profile system (admin pick set of auto-enabled/seeded plugins).
- Per-bundled-key disable/rotate. Bundled always-on; admin disable whole plugin if unwanted.

Add only when future plugin need ops-level rotation.

## Background — current state

- TMDB pure-global, `poolable: true`. `sharedCredentialsSchema.apiKey` **required**. Key live in encrypted `plugin_shared_credentials` pool via `sharedCredentialsService` (`apps/server/src/plugin-runtime/internal/shared-credentials.ts`).
- Resolution `packages/plugins/tmdb/src/client.ts:5` `resolveKey`: `ctx.credentials?.apiKey ?? ctx.sharedCredentials?.apiKey`. ⊥ key → `throw pluginError("plugin.bad_credentials")`.
- **Crux:** `buildCredentialPlan` (`runtime.ts:746`) global path `return adminOrdered` (`runtime.ts:763`) = active pool entries only. Empty pool → `plan.length === 0` → `runtime.ts:202` `throw PluginError("plugin.capability_unavailable")` **before handler run**. So source-level fallback in `resolveKey` **never fire** on empty pool. Bundled default MUST enter at plan layer.
- Onboarding (`apps/server/src/api/procedures/onboarding.ts:93`): `tmdbConfigured = (await sharedCredentialsService.countEnabled("tmdb")) > 0`. Drive "connect-services" step completion (`onboarding.ts:53`), step **required** (`onboarding.ts:52`).

## Key insight — single seam

`sharedCredentialsService` already read manifest JSON (`isPoolable`, `shared-credentials.ts:44`). Its `list` / `listDecryptedActive` / `countEnabled` are sole fan-in for:

- credential plan (`buildCredentialPlan` → `listDecryptedActive`)
- onboarding (`countEnabled` derive from `list`)
- admin UI (`GET /api/plugins/:id/shared-credentials` → `list`, `plugins.ts:101`)

Plus second `listDecryptedActive` consumer: `apps/server/src/media/internal/resolve-connection.ts:57` (non-user scope, ⊥ user connection → take `shared[0]`).

Synthesize bundled entry from manifest **inside these methods** → every consumer pick it up free. ⊥ migration, ⊥ DB row, ⊥ encryption-of-public-key theater, ⊥ reseed-on-version-bump. Single source of truth = plugin source.

**Bundled-last ordering correct for both `listDecryptedActive` consumers:** `buildCredentialPlan` tries picks in order (real first); `resolve-connection.ts:57` take `shared[0]` = first real key when any exist, else bundled. Empty pool non-user scope → returns bundled (was `[]`) = desired out-of-box. Real key present → bundled never index 0. Both correct ⊥ extra guard.

## Architecture

### 1. Manifest field (generic)

Add optional `defaultSharedCredentials?: JsonValue` to **shared** manifest: `PluginManifest` (`packages/shared/src/plugins/types.ts:46`) + `pluginManifestSchema` (`packages/shared/src/plugins/schemas.ts:80`). **Must live in shared schema** — `validate.ts:20` does `pluginManifestSchema.safeParse(...)` and returns `parsed.data` as `manifestJson`; field absent from schema → Zod **strips** it → never reach `sharedCredentialsService` (read manifest JSON). Then validate value at load against plugin own `sharedCredentialsSchema` (`packages/plugin-sdk/src/validate.ts`) — bad shape → load fail, ⊥ silent.

**Derived rule (add to existing `superRefine` in `pluginManifestSchema`, schemas.ts:80):** `defaultSharedCredentials !== undefined && sharedCredentialsSchema === undefined` → reject `plugin.input_invalid` "defaultSharedCredentials requires sharedCredentialsSchema". ⊥ schema → nothing to validate against → reject at install.

TMDB (`packages/plugins/tmdb/src/plugin.ts` manifest):

```ts
// Bundled TMDB v3 key — public by design (self-hosted, mirrors seerr). Admin
// pool entry or user key overrides; this is lowest-priority fallback.
defaultSharedCredentials: { apiKey: TMDB_BUNDLED_KEY }, // constants.ts
```

`sharedCredentialsSchema.apiKey` stay **required** — admin override path unchanged. `client.ts resolveKey` need **⊥ change**: bundled value arrive as `ctx.sharedCredentials`.

### 2. `sharedCredentialsService` — synthesize bundled entry

Reserved id const: `BUNDLED_CREDENTIAL_ID = "__bundled__"`. Label `"Bundled (default)"`.

Helper: read manifest of `pluginId`, return `defaultSharedCredentials` (or null). **Placeholder gate:** if value is the placeholder sentinel (`TMDB_BUNDLED_KEY === "REPLACE_WITH_NAMA_TMDB_V3_KEY"`), helper return **null** → ⊥ synthetic entry anywhere → `tmdbConfigured` stay **false** → onboarding step stay required. Prevents "configured but blank posters" trap (admin sees configured, no error, ⊥ posters). Real key registered → entry appears. (Chosen over build-time assert: works for self-host builds, degrade gracefully.)

- **`listDecryptedActive(pluginId)`** — append synthetic pick **after** real rows:
  `{ id: "__bundled__", label: "Bundled (default)", value: defaultSharedCredentials }`.
  → `buildCredentialPlan` global path non-empty → ⊥ `capability_unavailable`. Real keys sort first (override). Bundled = last-resort.
- **`list(pluginId)`** — append `SharedCredentialSummary` w/ new flag `bundled: true`, `enabled: true`, `lastExhaustedAt: null`, `retryAfter: null`. **Required `createdAt`/`updatedAt`** (both `number`, non-optional on summary): use the plugin row's `plugins.createdAt`/`updatedAt` ("installed since" — meaningful + stable across restarts; ⊥ epoch-0 churn).
  → `countEnabled` (derive from `list`, `shared-credentials.ts:106`) ≥ 1 → `tmdbConfigured` true → connect-services auto-complete = **optional**. ⊥ onboarding server change.
  → admin UI render read-only row.

Append order: real entries first (priority), bundled last.

### 3. Guards — fail loud

- `add` collision — existing check (`shared-credentials.ts:123`) already lowercases both sides AND iterates `this.list` output; once `list` include bundled summary, duplicate `"Bundled (default)"` label auto-rejected ci → `plugin.duplicate_label`. ⊥ new code.
- **`add` non-poolable gate — REAL BUG to fix.** `add` (`shared-credentials.ts:116`) throws `not_poolable` when `!isPoolable(manifestJson) && existing.length > 0`, `existing = this.list()`. Bundled appended → `existing` always ≥1 → non-poolable plugin w/ bundled default can **never** add real key (override blocked). Fix: compute the poolable-gate count **excluding** synthetic `__bundled__` (real rows only). TMDB poolable so unaffected, but generic mechanism breaks for non-poolable w/o this.
- **Read-only guards centralized in service layer** (single symmetric place; keep guard in same method that owns the by-id row). Every by-id mutator/reader reject `id === "__bundled__"` → new code `plugin.bundled_readonly`: `remove` (`shared-credentials.ts`), `setEnabled`, `update` (`:149`), `getDecrypted` (`:216`). `getDecrypted` matters: `runtime.ts:500 testSharedCredential` call it by id → admin "test" on bundled row must `bundled_readonly`, ⊥ `shared_credential_not_found`.
- `markExhausted` (`shared-credentials.ts:243`) — **no explicit guard, natural no-op**: DB UPDATE `id="__bundled__"` matches 0 rows → silent no-op (correct: ⊥ row to persist, public key retried). Chosen layer = service natural no-op (not runtime guard) — symmetric w/ other service guards, and 401≠429 so bundled rarely reach exhaustion path anyway. Bundled is last pick → loop ends → `pool_exhausted` if it 429s, correct.
- **401 / invalid bundled key** — upstream 401 → `handleHttpStatus` `plugin.bad_credentials` (`client.ts:40`). Bundled is last pick → no further failover → capability fail; `/public/trending` snapshot stay empty → backdrop fall back to bundled art. Placeholder key (`REPLACE_WITH_NAMA_TMDB_V3_KEY`) → exactly this until real key registered. ⊥ infinite retry: 401 ≠ 429, ⊥ `markExhausted`.

### 4. Types

`SharedCredentialSummary` is **server-only** (`apps/server/src/plugin-runtime/internal/shared-credentials.ts:24`) — **stays server-side** (Rule 11, ⊥ relocate to shared). Add `bundled?: boolean` there. The `GET /api/plugins/:id/shared-credentials` response wire type (whatever the client decodes) also gets `bundled?: boolean` so client render row read-only. ⊥ new shared type.

### 5. Client (admin UI)

Shared-credentials table (per `docs/2026-04-24-plugin-advanced-admin-design.md`, `admin/plugins.tsx`): bundled row → delete/disable/edit disabled, "Bundled" badge, one line "your own key takes priority". Onboarding `tmdb-key-form.tsx` copy: "Default key bundled — add your own to override." ⊥ server onboarding logic change.

### 6. Key value — release blocker

⚠️ Do **NOT** reuse jellyseerr key `431a8708161bcd1f1fbe7536137e61ed` (piggyback their TMDB account). Register **nama own free TMDB v3 key** before ship. Until then: placeholder const `TMDB_BUNDLED_KEY = "REPLACE_WITH_NAMA_TMDB_V3_KEY"`. **Enforced (§2 placeholder gate):** while key === placeholder, helper returns null → ⊥ synthetic entry → `tmdbConfigured` false → onboarding step stay required, ⊥ silent "configured but blank". Real key flips it on. Not just a doc note. Security: key public in source/bundle — same tradeoff as seerr, accepted (self-hosted).

## Data flow

```
invoke(tmdb metadata, empty pool)
  → buildCredentialPlan → listDecryptedActive("tmdb")
      real rows: []  +  synthetic [{__bundled__, {apiKey}}]
  → plan = [bundled]  (len 1, ⊥ capability_unavailable)
  → buildPickContext → ctx.sharedCredentials = {apiKey: bundled}
  → resolveKey → bundled key → TMDB fetch OK

admin add own key "Mine"
  → listDecryptedActive → [Mine, bundled]   (Mine first = priority)
  → bundled only used if Mine exhausted/429
```

## Test plan (Rule 9 — encode why)

- `listDecryptedActive` empty pool → bundled pick present, last. WHY: empty-pool invocation must not `capability_unavailable`.
- real + bundled → real first. WHY: admin key must override bundled.
- `countEnabled("tmdb")` empty pool → ≥1. WHY: onboarding step optional.
- `remove`/`setEnabled`("__bundled__") → `plugin.bundled_readonly`. WHY: bundled immutable.
- `add` reserved label → `duplicate_label`. WHY: ⊥ shadow bundled.
- `add` real key on **non-poolable** plugin w/ bundled default → succeeds (not `not_poolable`). WHY: bundled must ⊥ block override; poolable-gate excludes synthetic.
- `update`/`getDecrypted`/`remove`/`setEnabled`(`"__bundled__"`) → `plugin.bundled_readonly` (⊥ `shared_credential_not_found`). WHY: bundled immutable + decrypted value never fetched via by-id path; consistent error surface.
- `add` ci-variant reserved label (`"Bundled (Default)"`) → `duplicate_label`. WHY: lock case-insensitive normalization.
- placeholder key → `list`/`countEnabled` ⊥ bundled entry, `tmdbConfigured` false; real key → entry appears, true. WHY: ⊥ "configured but blank" trap.
- manifest `defaultSharedCredentials` w/o `sharedCredentialsSchema` → load reject `input_invalid`. WHY: nothing to validate against.
- `resolveConnections` (`resolve-connection.ts:57`) non-user scope, empty pool → returns bundled (`shared[0]`). WHY: out-of-box keyless fetch.
- same, real key present → `shared[0]` = real, ⊥ bundled. WHY: bundled lowest priority in 2nd consumer too.
- `markPickExhausted("__bundled__")` → no DB write. WHY: ⊥ row exist; public key retried.
- manifest `defaultSharedCredentials` bad shape vs `sharedCredentialsSchema` → load fail. WHY: fail loud.
- plugin w/o field → ⊥ synthetic entry anywhere. WHY: generic opt-in, ⊥ regress other plugins.

## Files touched

- `packages/shared/src/plugins/types.ts` + `schemas.ts` — manifest `defaultSharedCredentials?` (type + `pluginManifestSchema`, else stripped on parse).
- `packages/plugin-sdk/src/validate.ts` — validate value vs `sharedCredentialsSchema`.
- `packages/plugins/tmdb/src/constants.ts` — `TMDB_BUNDLED_KEY`.
- `packages/plugins/tmdb/src/plugin.ts` — manifest `defaultSharedCredentials`.
- `apps/server/src/plugin-runtime/internal/shared-credentials.ts` — synth in `list`/`listDecryptedActive`, guards, `bundled` flag, const.
- `packages/shared/src/plugins/schemas.ts` — `superRefine`: `defaultSharedCredentials` requires `sharedCredentialsSchema`.
- (runtime.ts unchanged — `markExhausted` natural 0-row no-op; guards live in service.)
- `apps/client/.../admin/plugins.tsx` — read-only bundled row.
- `apps/client/src/features/onboarding/.../tmdb-key-form.tsx` — copy.
- Changeset: `@nama/server` minor, `@nama/client` minor, `@nama/plugin-tmdb` minor.
