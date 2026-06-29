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

Add optional `defaultSharedCredentials?: JsonValue` to plugin manifest type (`packages/plugin-sdk/src/types.ts`, `ValidatedManifest`). Validate at load against plugin own `sharedCredentialsSchema` (`packages/plugin-sdk/src/validate.ts`) — bad shape → load fail, ⊥ silent.

TMDB (`packages/plugins/tmdb/src/plugin.ts` manifest):

```ts
// Bundled TMDB v3 key — public by design (self-hosted, mirrors seerr). Admin
// pool entry or user key overrides; this is lowest-priority fallback.
defaultSharedCredentials: { apiKey: TMDB_BUNDLED_KEY }, // constants.ts
```

`sharedCredentialsSchema.apiKey` stay **required** — admin override path unchanged. `client.ts resolveKey` need **⊥ change**: bundled value arrive as `ctx.sharedCredentials`.

### 2. `sharedCredentialsService` — synthesize bundled entry

Reserved id const: `BUNDLED_CREDENTIAL_ID = "__bundled__"`. Label `"Bundled (default)"`.

Helper: read manifest of `pluginId`, return `defaultSharedCredentials` (or null).

- **`listDecryptedActive(pluginId)`** — append synthetic pick **after** real rows:
  `{ id: "__bundled__", label: "Bundled (default)", value: defaultSharedCredentials }`.
  → `buildCredentialPlan` global path non-empty → ⊥ `capability_unavailable`. Real keys sort first (override). Bundled = last-resort.
- **`list(pluginId)`** — append `SharedCredentialSummary` w/ new flag `bundled: true`, `enabled: true`, `lastExhaustedAt: null`, `retryAfter: null`.
  → `countEnabled` (derive from `list`, `shared-credentials.ts:106`) ≥ 1 → `tmdbConfigured` true → connect-services auto-complete = **optional**. ⊥ onboarding server change.
  → admin UI render read-only row.

Append order: real entries first (priority), bundled last.

### 3. Guards — fail loud

- `add` — existing collision check (`shared-credentials.ts:123`) already lowercases both sides AND iterates `this.list` output; once `list` include bundled summary, duplicate `"Bundled (default)"` label auto-rejected ci → `plugin.duplicate_label`. ⊥ new code.
- `remove` / `setEnabled` / test-by-id — reject `id === "__bundled__"` → new code `plugin.bundled_readonly`. Bundled ⊥ deletable/disablable.
- `markPickExhausted` (`runtime.ts:270`) — no-op for `pick.entryId === "__bundled__"`: ⊥ row to persist; public key not rotated, retried next call. Rotation loop already `continue` past it harmlessly (bundled is last pick → loop ends → `pool_exhausted` if it 429s, correct).

### 4. Types

`SharedCredentialSummary` (`shared-credentials.ts:24`) add `bundled?: boolean`. Mirror into shared wire type if client read via `@nama/shared`. Client treat `bundled` row read-only.

### 5. Client (admin UI)

Shared-credentials table (per `docs/2026-04-24-plugin-advanced-admin-design.md`, `admin/plugins.tsx`): bundled row → delete/disable/edit disabled, "Bundled" badge, one line "your own key takes priority". Onboarding `tmdb-key-form.tsx` copy: "Default key bundled — add your own to override." ⊥ server onboarding logic change.

### 6. Key value — release blocker

⚠️ Do **NOT** reuse jellyseerr key `431a8708161bcd1f1fbe7536137e61ed` (piggyback their TMDB account). Register **nama own free TMDB v3 key** before ship. Until then: placeholder const `TMDB_BUNDLED_KEY = "REPLACE_WITH_NAMA_TMDB_V3_KEY"` + this blocker. Security: key public in source/bundle — same tradeoff as seerr, accepted (self-hosted).

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
- `markPickExhausted("__bundled__")` → no DB write. WHY: ⊥ row exist; public key retried.
- manifest `defaultSharedCredentials` bad shape vs `sharedCredentialsSchema` → load fail. WHY: fail loud.
- plugin w/o field → ⊥ synthetic entry anywhere. WHY: generic opt-in, ⊥ regress other plugins.

## Files touched

- `packages/plugin-sdk/src/types.ts` — manifest `defaultSharedCredentials?`.
- `packages/plugin-sdk/src/validate.ts` — validate vs `sharedCredentialsSchema`.
- `packages/plugins/tmdb/src/constants.ts` — `TMDB_BUNDLED_KEY`.
- `packages/plugins/tmdb/src/plugin.ts` — manifest `defaultSharedCredentials`.
- `apps/server/src/plugin-runtime/internal/shared-credentials.ts` — synth in `list`/`listDecryptedActive`, guards, `bundled` flag, const.
- `apps/server/src/plugin-runtime/service/runtime.ts` — `markPickExhausted` skip `__bundled__`.
- `apps/client/.../admin/plugins.tsx` — read-only bundled row.
- `apps/client/src/features/onboarding/.../tmdb-key-form.tsx` — copy.
- Changeset: `@nama/server` minor, `@nama/client` minor, `@nama/plugin-tmdb` minor.
