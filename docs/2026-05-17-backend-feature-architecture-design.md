# Backend Feature Architecture — Design

**Status:** Draft
**Date:** 2026-05-17
**Author:** Omid Astaraki
**Scope:** `apps/server/src/<module>/` for each domain module. Adapters (`api/`, `mcp/`) and infra (`db/`, `cache/`, `crypto/`, `connections/`, `diagnostics/`) are referenced but not modules.
**Related:** [`2026-05-07-frontend-feature-architecture-skill-design.md`](./2026-05-07-frontend-feature-architecture-skill-design.md), [`2026-04-20-job-service-design.md`](./2026-04-20-job-service-design.md), [`2026-04-27-catalog-service-design.md`](./2026-04-27-catalog-service-design.md), [`2026-05-05-home-page-backend-design.md`](./2026-05-05-home-page-backend-design.md), [`2026-04-25-notifications-design.md`](./2026-04-25-notifications-design.md).

## Summary

Convert `apps/server/src/` from a loosely-grouped set of domain directories into a modular monolith with hard, fallow-enforced boundaries between modules. Each module exposes a single barrel (`index.ts`) as its public surface; sync calls between modules go through that barrel, async signals go through events serialized as jobs on the existing `jobs/` infrastructure. Each module owns its drizzle tables. The architecture is captured as a Claude skill at `.agents/skills/backend-feature-architecture/`, symlinked into `.claude/skills/`, mirroring `frontend-feature-architecture`. `notifications/` is the canonical living example.

The design replaces the current coarse fallow zones (`server-domains` lumps seven domains together; `server-infra` lumps five) with per-module zones plus per-module `internal` sub-zones that block deep imports across modules. Boundary violations are fixed in-PR — fallow rules go to `error` from day one. A four-phase migration plan retrofits all nine modules, starting with `notifications/`, while leaving adapters and infra free of new constraints.

## Goals

- One enforced boundary per module: only `index.ts` is importable from outside the module.
- One consistent shape per module: reserved files for sync API, async events, repo, errors, types, jobs, tests.
- Inter-module sync calls go through the barrel-exported service; inter-module async signals go through `jobs/` as typed events.
- Each module owns its drizzle tables; other modules cannot query them directly.
- Auto-applied skill so agents reach for the same template before scaffolding new modules or editing existing ones.
- Symmetry with `frontend-feature-architecture`: same companion-skill model, same flat-with-reserved layout, same promotion rules.
- Future extract-to-service path: the boundary is already drawn at the module barrel and the event contract.

## Non-goals

- Restructuring `api/`, `mcp/`, or `db/schema/`. Adapters call modules, schema stays the central drizzle registry. (Per-module schema namespaces are explicitly deferred — see Phase 4.)
- Replacing the existing `jobs/` infrastructure. The bus IS `jobs/`.
- Introducing a separate event-emitter, message broker, or in-memory pub/sub. Pure best-effort signals continue to use direct calls into `cache/` and other infra utilities.
- Mandatory codemods or scaffolding scripts. Doc + canonical example + fallow enforcement.
- Splitting `apps/server` into multiple Node processes. Web and worker continue to share the same source tree.
- Retrofitting every drifted module in one shot. Phase 3 sequences the work, starting with `notifications/`.

## Decisions (with rationale)

| # | Decision | Rationale |
|---|---|---|
| 1 | Modules = domains only | DDD bounded contexts. Infra (`db/`, `cache/`, etc.) and adapters (`api/`, `mcp/`) are not domains and don't benefit from barrel discipline. |
| 2 | Hybrid communication: sync via barrel, async via `jobs/` events | Matches existing code shape. UI composition needs sync reads; side-effects already run via `jobs/`. Avoids two new patterns. |
| 3 | Reuse `jobs/` as the event bus | Persistence, retry, history, observability already there. Zero new dependency. Extract-to-service path stays open. |
| 4 | One module owns its tables | Required to keep the boundary meaningful. Without it, modules share state through the DB and the barrel is decorative. |
| 5 | Flat layout with reserved files (`service.ts`, `repo.ts`, `events.ts`, etc.) | Mirrors frontend. Matches current module sizes (5–17 files). Promotion path exists when files grow past caps. |
| 6 | Skill at `.agents/skills/backend-feature-architecture/` | Naming symmetry with frontend skill. Same `.claude/skills/` symlink pattern. |
| 7 | `notifications/` is the canonical exemplar | Most complete module: service, repos, delivery-job (async pattern), templates, error-sink, tests. Cleanest mapping to flat shape. Mirrors frontend's choice of notifications as exemplar. |
| 8 | Phase 1 fallow rules set to `error` immediately | No allowlist for existing violations. Fixed in-PR alongside zone splits. Otherwise debt accrues and boundaries become advisory. |
| 9 | Plan all nine modules in design, execute `notifications/` first as exemplar | Plan gives effort visibility. Executing one first proves the skill template before broad rollout. |

## Module map

Modules (each gets a fallow zone, a `<module>-internal` sub-zone, a barrel, and skill rules):

| Module | Path | Role |
|---|---|---|
| `artwork` | `apps/server/src/artwork/` | Artwork resolution, caching, URLs. |
| `auth` | `apps/server/src/auth/` | Sessions, users, OAuth provider integration. |
| `catalog` | `apps/server/src/catalog/` | Canonical media identity, catalog features, search/lookup. |
| `home` | `apps/server/src/home/` | Home-page layout composition, hero, row content. |
| `media` | `apps/server/src/media/` | Cross-plugin media operations: dispatch, ID resolution, invocation. |
| `notifications` | `apps/server/src/notifications/` | Inbox, delivery, recipients, templates, settings. **Canonical exemplar.** |
| `preferences` | `apps/server/src/preferences/` | User preferences. |
| `plugin-runtime` | `apps/server/src/plugin-runtime/` | Plugin host, registry, fetch policy, host bridge. |
| `jobs` | `apps/server/src/jobs/` | Job scheduler, registry, history, run logger. Also the **event bus**. |

NOT modules (shared utilities, free imports across server; no barrel, no skill):

- `db/` — drizzle client + schema registry.
- `cache/` — in-memory cache primitives.
- `crypto/` — encryption helpers.
- `connections/` — HTTP/fetch primitives.
- `diagnostics/` — logging, `HttpError`, error helpers.

Adapters (inbound only — call modules; modules never call back):

- `api/` — Hono routes + procedures.
- `mcp/` — MCP server entry.

## Module internal shape

Flat layout with reserved files. A file is created only when its role is needed in that module.

```
<module>/
├── index.ts          # barrel — public API, sole entry point
├── service.ts        # sync interface for other modules
├── events.ts         # event names (const), payload zod schemas, typed payload types
├── errors.ts         # typed error classes
├── types.ts          # public domain types
├── repo.ts           # drizzle queries on owned tables
├── jobs/             # async handlers (event consumers + scheduled work)
│   ├── index.ts      # registers all module jobs at boot
│   └── <handler>.ts  # one file per job / event handler
├── internal/         # private helpers — not exported via barrel
│   └── <helper>.ts
└── __tests__/
    ├── service.test.ts
    └── <handler>.test.ts
```

### Reserved file roles

| File | Role | May import | Notes |
|---|---|---|---|
| `index.ts` | Public surface. Re-exports from `service.ts`, `events.ts`, `errors.ts`, `types.ts`. | own files | Never re-exports `repo.ts`, `internal/`, `jobs/`. |
| `service.ts` | Sync methods other modules call. | own `repo.ts`, `events.ts`, `types.ts`, `errors.ts`, `internal/`, shared infra (`db/`, `cache/`, `crypto/`, `connections/`, `diagnostics/`), shared-pkg, other modules' **barrels** | Must not `import 'drizzle-orm'` or drizzle helpers — go via `repo.ts`. |
| `events.ts` | Event names + zod payload schemas + derived types. | shared-pkg, `zod` | Pure module. No runtime side-effects. |
| `errors.ts` | Typed error classes. | nothing | Pure. |
| `types.ts` | Public domain types. | shared-pkg, own `errors.ts` | Pure. |
| `repo.ts` | Drizzle queries on **owned** tables. | `db/`, own `types.ts`, own `errors.ts`, shared-pkg | The only place `import { ... } from "drizzle-orm"` is allowed inside a module. |
| `jobs/<x>.ts` | Async handler. Registers via `registerJob(EVENT_NAME, fn)`. | own `service.ts`, own `repo.ts`, own `events.ts`, jobs/, other modules' barrels | One file per event handled. File name = event handled. |
| `internal/` | Private helpers. | own files, shared infra | Never imported from outside the module — enforced by `<module>-internal` sub-zone. |

### Promotion rules

- `service.ts` > 500 LOC → split into `service/` directory; re-export public methods from `service/index.ts`. One responsibility per file (`canonicalize.ts`, `enrich.ts` — never `helpers.ts`, `utils.ts`, `misc.ts`).
- `repo.ts` > 300 LOC → `repo/` directory, one file per entity.
- `internal/` is already a directory — extract helpers there as the module grows.
- Same promotion rule applied recursively. Mirrors frontend [`#17 decompose large components`](https://www.notion.so/) convention.

### Size and complexity budgets

| Target | Soft cap | Hard cap | Enforcement |
|---|---|---|---|
| `service.ts` LOC | 300 | 500 | pre-commit / CI script (`wc -l`) |
| `repo.ts` LOC | 200 | 300 | pre-commit / CI script |
| `events.ts` LOC | 150 | 200 | pre-commit / CI script |
| `jobs/<x>.ts` LOC | 150 | 200 | pre-commit / CI script |
| any function LOC | — | 50 | review |
| cyclomatic per function | — | 15 | fallow `health.maxCyclomatic` lowered to 15 for module code, 20 stays for adapters |
| cognitive per function | — | 15 | fallow `health.maxCognitive` (unchanged) |
| parameters per function | — | 3 | review (clean-code skill) |

### Hard rules (cite by number in PR descriptions and reviews)

1. **Barrel-only entry.** Other modules import via `@/<module>` or a relative path that resolves to `<module>/index.ts`. Deep imports (resolving to `service.ts`, `repo.ts`, `internal/`, `jobs/`) from outside the module are forbidden — enforced by fallow `<module>-internal` zone.
2. **No raw drizzle outside `repo.ts`.** `service.ts` and `jobs/` call `repo.fn()`. Only `repo.ts` (or `repo/<file>.ts`) imports `drizzle-orm` and the schema.
3. **Own tables only in own `repo.ts`.** A module's `repo.ts` reads/writes only the tables that module owns. Reading another module's table = call the owner's barrel.
4. **Sync via `service.ts`, async via `events.ts` + `jobs/`.** No cross-module fire-and-forget via direct function calls. No cross-module DB writes through shared schema imports.
5. **`events.ts` is the published async contract.** Adding or changing event payload fields = changeset entry + semver bump for `@ent-mcp/server`.
6. **Tests live in `__tests__/` next to code.** Unit tests mock `repo.ts`. Integration tests mock other modules' barrels, not their internals.
7. **One handler per file in `jobs/`.** File name matches the event handled (e.g. `on-media-added.ts` for `catalog.media.added`).
8. **`internal/` is private.** Never imported from outside the module. Enforced by fallow `<module>-internal` sub-zone.
9. **No cyclic module deps.** `A → B → A` forbidden. Break the cycle with an event. Fallow `circular-deps` is `error` for `server-mod-*` zones.
10. **Adapters (`api/`, `mcp/`) only call module barrels.** They never reach into module internals; modules never call adapters.
11. **No `utils.ts`, `helpers.ts`, `misc.ts`.** Junk-drawer names hide growth. Name files by responsibility.
12. **One source of strings for events.** `events.ts` exports an `as const` object plus the zod schemas; emitters reference the constant, never the literal.

## Inter-module communication

### Sync — barrel-exported service

`service.ts` returns a singleton (or a typed factory) the module exports through `index.ts`. Consumers receive the typed interface.

```ts
// catalog/service.ts
export class CatalogService {
  constructor(private repo: CatalogRepo) {}
  async getCanonical(id: string): Promise<CanonicalMedia> { ... }
  async search(query: string): Promise<CanonicalMedia[]> { ... }
}

// catalog/index.ts
export { CatalogService } from "./service";
export * from "./events";
export * from "./errors";
export type * from "./types";
export const getCatalogService = (): CatalogService => container.resolve(CatalogService);

// home/orchestrator.ts (consumer)
import { getCatalogService } from "../catalog";        // barrel — OK
// import { CatalogRepo } from "../catalog/repo";      // would be blocked by fallow
```

### Async — events as jobs

`events.ts` declares event names and zod payload schemas. Emitters enqueue via `jobs/`; handlers register through `jobs/registry`.

```ts
// catalog/events.ts
import { z } from "zod";

export const CATALOG_EVENTS = {
  MEDIA_ADDED: "catalog.media.added",
  MEDIA_REMOVED: "catalog.media.removed",
} as const;

export const mediaAddedPayload = z.object({
  mediaId: z.string(),
  userId: z.string(),
  occurredAt: z.string().datetime(),
});
export type MediaAddedPayload = z.infer<typeof mediaAddedPayload>;
```

```ts
// catalog/service.ts (emitter)
import { enqueue } from "../jobs";
import { CATALOG_EVENTS, type MediaAddedPayload } from "./events";

async addMedia(input: ...) {
  await this.repo.insert(input);
  await enqueue<MediaAddedPayload>(CATALOG_EVENTS.MEDIA_ADDED, { mediaId, userId, occurredAt });
}
```

```ts
// notifications/jobs/on-catalog-media-added.ts (consumer)
import { registerJob } from "../../jobs";
import { CATALOG_EVENTS, mediaAddedPayload, type MediaAddedPayload } from "../../catalog";
import { getNotificationsService } from "..";

registerJob<MediaAddedPayload>(CATALOG_EVENTS.MEDIA_ADDED, mediaAddedPayload, async (payload) => {
  await getNotificationsService().notifyMediaAdded(payload);
});
```

Conventions:

- Event names: `<module>.<entity>.<verb-past-tense>`. Lower-kebab on each segment.
- Payloads validated by zod on enqueue and on dispatch.
- Handlers are idempotent. Job retry semantics already enforce this in `jobs/runner.ts`.
- Emitting fails-closed: if `events.ts` zod validation fails at enqueue, the calling sync operation rolls back.
- One event may have multiple handlers across modules. `jobs/registry` supports `registerJob` for the same name from multiple modules.

### Choosing sync vs async

> **Sync** when the caller needs the result to complete its work (e.g. `home` composes layout from `catalog`).
> **Async (event)** when the caller signals "this happened" and doesn't need an answer (e.g. media added → notify users, refresh search index).

Heuristic in skill: *if removing the call would leave the caller's return value unchanged but produce a missing side-effect, it should be an event.*

## DB ownership

### Today

`apps/server/src/db/schema/` is a single registry imported freely from any directory. Reads, writes, and migrations are global.

### Target

The schema registry stays in `db/schema/` (no per-module schema namespaces in this design — see Phase 4). Ownership is enforced **by repo discipline**, not file location:

- Each table has a single owning module, declared in a registry comment block at the top of the schema file (e.g. `// @owner: notifications`).
- Only the owning module's `repo.ts` imports that table.
- Other modules read/write through the owning module's barrel.

Enforcement options for the design phase:

1. **Convention + review** in Phase 3 (this design).
2. **Pre-commit script** in Phase 3.b: parse schema files for `@owner:` directives and grep for cross-module imports of those table identifiers.
3. **Per-module schema namespaces** in Phase 4 (deferred): split `db/schema/` into `db/schema/<module>/`, give each module a fallow rule that allows only its own schema subpath.

Phase 3 ships option 1+2. Option 3 is a follow-up spec.

### Drizzle migration scope

Migrations stay in `apps/server/drizzle/` and remain global. Per-module migrations are out of scope (would block running web + worker as one Node process). Ownership is enforced at the read-write boundary only.

## Fallow boundaries

### Replace `server-domains` and `server-infra` mega-zones

Today (`.fallowrc.json` lines 180–205):

```json
{ "name": "server-domains", "patterns": [".../artwork/**", ".../auth/**", ...one bucket for seven domains... ] },
{ "name": "server-infra",   "patterns": [".../db/**", ".../cache/**", ".../crypto/**", ".../connections/**", ".../diagnostics/**" ] },
```

Replace with per-module zones plus `-internal` sub-zones:

```jsonc
// per-module zones (one pair per module)
{ "name": "server-mod-artwork",         "patterns": ["apps/server/src/artwork/index.ts"] },
{ "name": "server-mod-artwork-internal","patterns": ["apps/server/src/artwork/**", "!apps/server/src/artwork/index.ts"] },

{ "name": "server-mod-auth",            "patterns": ["apps/server/src/auth/index.ts"] },
{ "name": "server-mod-auth-internal",   "patterns": ["apps/server/src/auth/**", "!apps/server/src/auth/index.ts"] },

// ... same shape for catalog, home, media, notifications, preferences, plugin-runtime, jobs

// infra stays one zone, locked down
{ "name": "server-infra", "patterns": ["apps/server/src/db/**", "apps/server/src/cache/**", "apps/server/src/crypto/**", "apps/server/src/connections/**", "apps/server/src/diagnostics/**"] },

// adapters
{ "name": "server-api", "patterns": ["apps/server/src/api/**"] },
{ "name": "server-mcp", "patterns": ["apps/server/src/mcp/**"] }
```

If fallow does not support negated patterns in a single zone, fall back to: `server-mod-<x>` covers `<x>/index.ts` only; `server-mod-<x>-internal` covers all of `<x>/**` (overlap is OK — the rules below give the correct semantics).

### Rules (the boundary contract)

For each module `<x>`:

```jsonc
{
  "from": "server-mod-<x>",
  "allow": [
    "server-mod-<x>-internal",
    "server-infra",
    "server-mod-jobs",
    "server-mod-<other>",     // other module BARRELS (not -internal)
    "shared-pkg",
    "plugin-sdk"
  ]
},
{
  "from": "server-mod-<x>-internal",
  "allow": [
    "server-mod-<x>",
    "server-mod-<x>-internal",
    "server-infra",
    "server-mod-jobs",
    "server-mod-<other>",     // OK to import another module's barrel from internal too
    "shared-pkg",
    "plugin-sdk"
  ]
}
```

Key property: **no rule allows `server-mod-<x>-internal` to be imported from `server-mod-<y>-internal` or `server-mod-<y>`** (for `y ≠ x`). That's the entire trick.

Adapter rules:

```jsonc
{
  "from": "server-api",
  "allow": ["server-mod-*", "server-infra", "shared-pkg", "plugin-sdk", "server-mcp"]
},
{
  "from": "server-mcp",
  "allow": ["server-mod-*", "server-infra", "shared-pkg", "plugin-sdk"]
}
```

Adapter restrictions:

- Modules MAY NOT import from `server-api` or `server-mcp`.
- `server-api` and `server-mcp` MAY import only module **barrels** (`server-mod-<x>`), not `-internal` zones.

Infra rules (tightened from today):

```jsonc
{ "from": "server-infra", "allow": ["shared-pkg", "plugin-sdk"] }
```

Today `server-infra` allows `server-plugins` and `server-domains`. That allowed reverse imports. Phase 1 removes them; any infra → domain reference is a code smell to fix in the same PR.

Plugins:

```jsonc
{ "from": "server-mod-plugin-runtime", "allow": [...standard module allow list..., "plugins"] }
```

`plugins` (i.e. `packages/plugins/**`) only flow into `plugin-runtime`. Other modules don't reference plugin packages directly.

### Severity

```jsonc
"rules": {
  "unused-files":   "error",       // unchanged
  "unused-exports": "error",       // unchanged
  "unused-types":   "warn",        // unchanged
  "unused-deps":    "warn",        // unchanged
  "circular-deps":  "error"        // tightened from warn, scoped to server-mod-*
}
```

Boundary violations are always `error` (fallow default). Phase 1 PRs land both the zone splits and the fixes — no warn-window.

### Health budgets

`health.maxCyclomatic`: 20 → **15** for module code, 20 stays for adapters and infra. (Implementation depends on whether fallow supports per-zone health budgets. If not, project-wide tighten to 15 and exempt `server-api/**` and `server-mcp/**` from the health rule via `health.ignore`.)

## Skill artifact

### Location

```
.agents/skills/backend-feature-architecture/
├── SKILL.md
├── references/
│   ├── module-layout.md
│   ├── service-and-repo.md
│   ├── events-and-jobs.md
│   ├── db-ownership.md
│   ├── fallow-zones.md
│   ├── checklist.md
│   └── examples/
│       ├── new-module.md
│       ├── add-event.md
│       └── retrofit-existing.md
└── metadata.json
```

`.claude/skills/backend-feature-architecture` symlinks to `../../.agents/skills/backend-feature-architecture`, matching the existing pattern.

### `SKILL.md` shape

Frontmatter:

```yaml
---
name: backend-feature-architecture
description: Standard architecture for apps/server/src/<module>/ modules. Use when creating a new server module, retrofitting an existing one, or reviewing module-folder PRs. Covers folder layout (flat with reserved files), sync API via barrel, async events via jobs, DB ownership, and fallow zones. Notifications is the canonical example.
metadata:
  version: "1.0.0"
---
```

Top-of-file index:

1. Module map (which dirs are modules; which are adapters/infra)
2. Decision tree (new module vs retrofit)
3. Hard rules (numbered 1–12 — same numbering as this design)
4. Companion skills (`clean-code`, `fallow`, `es-toolkit`, `backprop`, `paraglide-js`)
5. Section index (links into `references/`)
6. Canonical example pointer: `apps/server/src/notifications/`

Length budget: ~180–220 lines. Detail in references.

### Companion skills

| Skill | Trigger | Why |
|---|---|---|
| `clean-code` | New/edit module file | Small functions, naming, single responsibility, parameter count |
| `fallow` | Before commit on module change | Verify zone rules + health budgets |
| `es-toolkit` | Array/object/string ops in service or repo | Replace native/custom utils |
| `backprop` | Bug found in module | Decide if a new invariant prevents recurrence |
| `paraglide-js` | User-facing strings (rare; mostly errors flowed to UI) | i18n via `m.*` |

Skip frontend-specific skills (`vercel-react-*`, `shadcn`, `web-design-guidelines`, `vercel-composition-patterns`, `vercel-react-view-transitions`).

### Workflow section in `SKILL.md`

1. Identify whether you're creating a new module, retrofitting, or adding a feature to an existing module.
2. Read `module-layout.md` for the file shape.
3. Read `service-and-repo.md` for the sync API contract.
4. Read `events-and-jobs.md` for the async pattern.
5. Read `db-ownership.md` if the change introduces or moves a table.
6. Update `.fallowrc.json` zones if a new module is added.
7. Run `vp check` and `vp test` (per project memory #8, #9 guardrails).
8. Run `fallow health --format json --quiet 2>/dev/null || true` before opening the PR.

## Migration plan

### Phase 1 — Boundary scaffolding (single PR)

- Split `.fallowrc.json` `server-domains` mega-zone into per-module zones + `-internal` sub-zones.
- Lock infra zone to `shared-pkg` + `plugin-sdk` only.
- Add zone rules per the contract above.
- Fix every cross-module deep import that fallow now flags. No allowlist. (Expectation: ~30–60 imports across 9 modules; most are `home → media`, `home → catalog`, `notifications → connections`. Survey before PR.)
- Add file-size pre-commit script under `tools/`.

Exit criteria: `vp check`, `vp test`, `fallow health` all green. Zero allowlisted violations.

### Phase 2 — Skill + exemplar (single PR)

- Refactor `notifications/` to the new shape: extract `repo.ts` from `repos.ts`, declare `events.ts` with current emit points (`emit.ts` → restructure), formalize `internal/` for `resolve-recipients.ts`, `delivery-policy.ts`, etc.
- Write `.agents/skills/backend-feature-architecture/SKILL.md` + references + symlink.
- Reference `notifications/` from the skill as canonical example.
- Add the changeset entry for `@ent-mcp/server` (minor — public surface of `notifications/` changed).

Exit criteria: `notifications/` matches the template; skill lints clean; `vp check` + `vp test` green.

### Phase 3 — Per-module retrofit (one PR per module)

Sequence (loosely by current size and risk):

1. `preferences/` — smallest, simplest.
2. `auth/` — well-contained.
3. `artwork/` — small surface.
4. `catalog/` — central but well-shaped; main change is `service.ts` → `service/` directory.
5. `home/` — most internal coupling to clean up; will be the longest PR.
6. `media/` — largest; `service.ts` (32 KB) splits into `service/` directory with `dispatch.ts`, `invoke.ts`, `id-resolver.ts` etc.
7. `plugin-runtime/` — `runtime.ts` (31 KB) splits.
8. `jobs/` — last (used by every other module; minimal shape change since it already mostly fits).

Per module:

- Move private helpers under `internal/`.
- Extract `repo.ts` from current data-access code.
- Convert any cross-module imports to barrel-only.
- Add `events.ts` if the module emits events.
- Verify `vp check`, `vp test`, `fallow health`.
- Changeset entry: `minor` for any external surface change, empty (`---\n---`) for pure refactor.

### Phase 4 — Per-module schema namespaces (separate spec, deferred)

Out of scope here. Tracked as follow-up: split `db/schema/` into `db/schema/<module>/`, give each module a fallow allow rule for its own schema namespace, retrofit migrations.

### Estimated effort

| Module | Files now | Effort (engineer-days, est.) |
|---|---|---|
| `preferences/` | 3 | 0.5 |
| `auth/` | 7 | 1.0 |
| `artwork/` | 5 (est.) | 0.5 |
| `catalog/` | 9 | 1.5 |
| `notifications/` | 9 (incl. templates/) | 1.0 (exemplar PR) |
| `home/` | 13 | 2.0 |
| `media/` | 17 | 3.0 |
| `plugin-runtime/` | 11 | 2.0 |
| `jobs/` | 17 | 1.5 |
| **Total (Phase 2 + 3)** | | **~13 engineer-days** |

Phase 1 adds another ~1 engineer-day for the zone split + import fixes.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Fallow does not support per-zone health budgets | Tighten project-wide to 15; exempt adapters via `health.ignore` patterns. |
| Fallow boundary trick (root vs `-internal` zone) is fragile if it can't negate patterns | Test on a single module first (`preferences/`) before splitting all nine. Fall back to convention + grep pre-commit if needed. |
| File-size cap script blocks emergency fixes | Cap is hard-error on hard limit only; soft cap is warning. CI bypass requires `--allow-large-files` flag with explicit justification. |
| Skill drifts from code over time | Skill links to live files (no copies). Phase 2 PR adds a CI check that `notifications/` matches the template (file presence + barrel export shape). |
| Cross-module event handlers create implicit cycles | Fallow `circular-deps: error` for `server-mod-*` catches direct cycles. Async cycles (A emits → B handles → B emits → A handles) are detectable via `fallow` import graph; document the pattern in `events-and-jobs.md`. |
| DB ownership convention drifts without enforcement | Phase 3.b pre-commit script enforces `@owner:` directive ↔ repo import map. Phase 4 (deferred) makes it structural. |
| Phase 3 PRs balloon if devs do "while I'm here" cleanup | Skill includes a Phase 3 checklist; reviewers cite Rule 1 (surgical changes — code/CLAUDE.md Rule 3). |
| `notifications/` exemplar diverges as features land | Add an integration test that asserts `notifications/index.ts` re-exports `service`, `events`, `errors`, `types` and nothing else. |

## Testing plan

- Unit: per-module `__tests__/service.test.ts` mocks `repo.ts`. Existing test counts preserved.
- Integration: a new `apps/server/src/__tests__/boundaries.test.ts` enumerates each module and asserts:
  - `index.ts` exists.
  - `index.ts` re-exports only the allowed names (service, events, errors, types).
  - No file outside the module references `<module>/repo.ts`, `<module>/internal/**`, or `<module>/jobs/**`.
  - Pre-commit hook executes the same checks faster against changed files only.
- Smoke: `vp test` runs all server tests; CI runs `fallow health --format json --quiet 2>/dev/null || true` and fails on any boundary violation.
- Per project memory guardrails #8 and #9, every commit in this work must pass `vp check` and `vp test`.

## Success criteria

1. `.fallowrc.json` contains 9 `server-mod-<x>` zones + 9 `server-mod-<x>-internal` zones; `server-domains` is removed.
2. `fallow health` reports zero boundary violations on `main`.
3. Every module has `index.ts`, `service.ts`, `repo.ts` (if it touches DB), `errors.ts`, `types.ts`, and `__tests__/`.
4. `notifications/` matches the canonical layout exactly; the boundaries test (above) asserts this.
5. `.agents/skills/backend-feature-architecture/SKILL.md` exists, is symlinked into `.claude/skills/`, and is referenced from `apps/server/CLAUDE.md` (or root `CLAUDE.md` Frontend Skills block extended with a Backend Skills block).
6. Cross-module imports resolve only to `<module>/index.ts`. Grep across `apps/server/src/` for `from "../<module>/repo"`, `from "../<module>/internal"`, `from "../<module>/jobs"` returns zero hits.
7. Each owned drizzle table has an `@owner:` directive in its schema file matching the module that imports it in `repo.ts`. Pre-commit script verifies the mapping.
8. No new `utils.ts`, `helpers.ts`, or `misc.ts` files in modules (lint or pre-commit rule).
9. Documentation: `CLAUDE.md` extended with backend skill block mirroring the frontend block; this design doc committed at `docs/2026-05-17-backend-feature-architecture-design.md`.

## Open questions

1. **Per-zone fallow health budgets** — does fallow support them, or do we project-wide-tighten + exempt adapters? Confirm during Phase 1 spike.
2. **Negated pattern support in fallow zones** — needed for the `<module>` vs `<module>-internal` two-zone trick. If not supported, fall back to overlap + rule semantics.
3. **`@owner:` directive parser** — handwritten regex in pre-commit, or use an existing TS AST tool already in the repo? Decide during Phase 3.b.
4. **`jobs/` API surface for events** — current `enqueue` / `registerJob` signatures may need a thin typed wrapper to enforce zod payload validation on both ends. Design during Phase 2.

## Rollout

- Phase 1 PR: `server-mod-* zones + cross-module deep-import cleanup`. Reviewer: at least one server lead.
- Phase 2 PR: `notifications/ retrofit + backend-feature-architecture skill`. Reviewer: same as Phase 1.
- Phase 3 PRs: one per module. Each PR includes a changeset entry (per `CLAUDE.md` Pull Requests and Versioning section).
- Communication: post in #engineering when Phase 1 lands; require reviewers to cite Rule numbers when blocking PRs on boundary issues.

## Appendix A — Survey of current cross-module deep imports (to fix in Phase 1)

A spike before opening the Phase 1 PR will produce the full list. Initial sample from `home/orchestrator.ts`:

- `from "../catalog/canonical"` — needs barrel export of `toCanonicalRow` from `catalog/index.ts`, or moved into `home/internal/`.
- `from "../media/service"` — needs barrel export of `MediaService` (or its singleton accessor) from `media/index.ts`.
- `from "../media/errors"` — needs `AllPluginsFailedError`, `PluginCallError` re-exported from `media/index.ts`.
- `from "../diagnostics/http-errors"` — already in `server-infra`; remains allowed.

Each module gets a similar mini-survey appended here before Phase 1 lands.

## Appendix B — Example new module (skeleton)

```
apps/server/src/watchlist/
├── index.ts
├── service.ts
├── events.ts
├── errors.ts
├── types.ts
├── repo.ts
└── __tests__/
    └── service.test.ts
```

```ts
// index.ts
export { WatchlistService, getWatchlistService } from "./service";
export * from "./events";
export * from "./errors";
export type * from "./types";
```

```ts
// events.ts
import { z } from "zod";
export const WATCHLIST_EVENTS = {
  ITEM_ADDED: "watchlist.item.added",
} as const;
export const itemAddedPayload = z.object({ userId: z.string(), mediaId: z.string() });
export type ItemAddedPayload = z.infer<typeof itemAddedPayload>;
```

Skeleton above is the minimum bar for a new module. Phase 2's skill scaffolds it.
