# Backend Feature Architecture — Design

**Status:** Approved
**Date:** 2026-05-17
**Author:** Omid Astaraki
**Scope:** `apps/server/src/<module>/` for each domain module. Adapters (`api/`, `mcp/`) and infra (`db/`, `cache/`, `crypto/`, `connections/`, `diagnostics/`, `jobs/`) are referenced but not modules.
**Related:** [`2026-05-07-frontend-feature-architecture-skill-design.md`](./2026-05-07-frontend-feature-architecture-skill-design.md), [`2026-04-20-job-service-design.md`](./2026-04-20-job-service-design.md), [`2026-04-27-catalog-service-design.md`](./2026-04-27-catalog-service-design.md), [`2026-05-05-home-page-backend-design.md`](./2026-05-05-home-page-backend-design.md), [`2026-04-25-notifications-design.md`](./2026-04-25-notifications-design.md).

## Summary

Convert `apps/server/src/` from a loosely-grouped set of domain directories into a modular monolith with hard, fallow-enforced boundaries between modules. Each module exposes a single barrel (`index.ts`) as its public surface; sync calls between modules go through that barrel, async signals go through events serialized as jobs on the existing `jobs/` infrastructure. Each module owns its drizzle tables. The architecture is captured as a Claude skill at `.agents/skills/backend-feature-architecture/`, symlinked into `.claude/skills/`, mirroring `frontend-feature-architecture` (which is 106 lines of `SKILL.md` + 6 references totaling ~786 lines; this skill targets the same envelope).

The design replaces the current coarse fallow zones (`server-domains` lumps seven domains together; `server-infra` lumps five) with per-module zones plus per-module `internal` sub-zones that block deep imports across modules. The barrel/internal split exploits fallow's documented **first-match-wins** zone-membership semantics (`BoundaryZone` schema: *"A file belongs to the first zone whose pattern matches."*) — list `server-mod-<x>` (matching only `<x>/index.ts`) before `server-mod-<x>-internal` (matching all of `<x>/**`) and `index.ts` falls into the public zone while everything else falls into the internal zone. No negated globs required.

Boundary violations are fixed in-PR — fallow rules go to `error` from day one. The full deep-import survey (71 occurrences across 8 modules; see Appendix A) is included in this design, not deferred. A four-phase migration plan retrofits all eight modules, starting with `notifications/`, while leaving adapters and infra free of new constraints. `jobs/` is treated as **infra**, not a module: it exposes `enqueue` and `registerJob` as the bus API, and modules import it the same way they import `db/` or `cache/`.

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
| 3 | Reuse `jobs/` as the event bus; classify `jobs/` as **infra**, not a module | Persistence, retry, history, observability already there. Zero new dependency. Every module imports `enqueue`/`registerJob` from `jobs/`; that's exactly the shape of infra usage, not module-to-module communication. Treating it as a module would force every emit and every handler registration to import a barrel — circular with the very mechanism being defined. |
| 4 | One module owns its tables | Required to keep the boundary meaningful. Without it, modules share state through the DB and the barrel is decorative. |
| 5 | Flat layout with reserved files (`service.ts`, `repo.ts`, `events.ts`, etc.) | Mirrors frontend. Matches current module sizes (5–17 files). Promotion path exists when files grow past caps. |
| 6 | Skill at `.agents/skills/backend-feature-architecture/` | Naming symmetry with frontend skill. Same `.claude/skills/` symlink pattern. |
| 7 | `notifications/` is the canonical exemplar | Most complete module: service, repos, delivery-job (async pattern), templates, error-sink, tests. Cleanest mapping to flat shape. Mirrors frontend's choice of notifications as exemplar. |
| 8 | Phase 1 fallow rules set to `error` immediately | No allowlist for existing violations. Fixed in-PR alongside zone splits. Otherwise debt accrues and boundaries become advisory. |
| 9 | Plan all eight modules in design, execute `notifications/` first as exemplar | Plan gives effort visibility. Executing one first proves the skill template before broad rollout. |
| 10 | Wrapper splits across `jobs/{event-name,emit,on,events}.ts` instead of a single `jobs/events.ts` (Phase 2 finding) | A single file would route `runner.ts` (emits `jobs.run.failed`) → `events.ts` → `triggerable.ts` → `runner.ts` — a static cycle fallow rejects under `circular-deps: error`. The split keeps `emit` independent of `triggerable`, so `runner.ts` imports `./emit` directly and the cycle never forms. Public API (`import { emit, on } from "../jobs/events"`) is unchanged. |
| 11 | Runner skips `emitJobOutcome` when the failing job IS the dispatcher of a typed runtime event | Otherwise a downstream fault inside the `jobs.run.failed` handler (notifications DB unavailable, etc.) would re-emit `jobs.run.failed` for the handler-job and cascade unboundedly. `EVENT_DISPATCHER_JOB_IDS` lives next to the event constants in `jobs/runtime-events.ts`; `apps/server/src/__tests__/boot.test.ts` enforces that every value in `JOB_EVENTS` is present in the skip-list so adding a new runtime event without updating the set fails CI. |
| 12 | Cloudflare Worker entry point registers ONLY `notifications.registerJobs({ scheduled: false })` | Workers has no persistent process, so croner-backed scheduled jobs (catalog/home/preferences/plugin-runtime/stale-pending-sweep) would fail in the isolate. Notifications' triggerable delivery + demo jobs and the four typed-event handlers stay registered so HTTP-triggered emits still land on delivery; the sweep is the only piece skipped, and it has no Workers equivalent. |

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

NOT modules (shared utilities, free imports across server; no barrel, no skill):

- `db/` — drizzle client + schema registry.
- `cache/` — in-memory cache primitives.
- `crypto/` — encryption helpers.
- `connections/` — HTTP/fetch primitives.
- `diagnostics/` — logging, `HttpError`, error helpers.
- `jobs/` — scheduler, registry, history, run logger. Doubles as the **event bus** (`enqueue`, `registerJob`). Treated as infra because every module imports it the same way they import `db/`. Its own internal complexity is governed by clean-code and fallow health budgets, but not by module-barrel rules.

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
| `service.ts` | Sync methods other modules call. | own `repo.ts`, `events.ts`, `types.ts`, `errors.ts`, `internal/`, shared infra (`db/`, `cache/`, `crypto/`, `connections/`, `diagnostics/`, `jobs/`), shared-pkg, other modules' **barrels** | Must not `import 'drizzle-orm'` or drizzle helpers — go via `repo.ts`. |
| `events.ts` | Event names + zod payload schemas + derived types. | shared-pkg, `zod` | Pure module. No runtime side-effects. |
| `errors.ts` | Typed error classes. | nothing | Pure. |
| `types.ts` | Public domain types. | shared-pkg, own `errors.ts` | Pure. |
| `repo.ts` | Drizzle queries on **owned** tables. | `db/`, own `types.ts`, own `errors.ts`, shared-pkg | The only place `import { ... } from "drizzle-orm"` is allowed inside a module. |
| `jobs/<x>.ts` | Async handler. Exports `register<X>(): void` which calls `on(EVENT_NAME, schema, fn)` from `jobs/events`. No top-level side effects. | own `service.ts`, own `repo.ts`, own `events.ts`, `jobs/` infra, other modules' `events.ts` (allowed because it's a re-export from the barrel; payload schema is part of the published contract), other modules' barrels | One file per event handled. File name matches event handled. |
| `jobs/index.ts` | Single `registerJobs()` function that calls every `register<X>()` in this module. Re-exported via the module barrel. | own `jobs/<x>.ts` files | Sole entry point used by `apps/server/src/{index,worker}.ts`. |
| `internal/` | Private helpers. | own files, shared infra | Never imported from outside the module — enforced by `<module>-internal` sub-zone. |

### Promotion rules

- `service.ts` > 500 LOC → split into `service/` directory; re-export public methods from `service/index.ts`. One responsibility per file (`canonicalize.ts`, `enrich.ts` — never `helpers.ts`, `utils.ts`, `misc.ts`).
- `repo.ts` > 300 LOC → `repo/` directory, one file per entity.
- `internal/` is already a directory — extract helpers there as the module grows.
- Same promotion rule applied recursively. Mirrors frontend [`#17 decompose large components`](https://www.notion.so/) convention.

### Size and complexity budgets

| Target | Soft cap | Hard cap | Enforcement |
|---|---|---|---|
| `service.ts` LOC | 400 | 500 | pre-commit / CI script (`wc -l`) |
| `repo.ts` LOC | 240 | 300 | pre-commit / CI script |
| `events.ts` LOC | 160 | 200 | pre-commit / CI script |
| `jobs/<x>.ts` LOC | 160 | 200 | pre-commit / CI script |
| any function LOC | — | 50 | review |
| cyclomatic per function | — | 15 | fallow `health.maxCyclomatic` lowered to 15 for module code, 20 stays for adapters |
| cognitive per function | — | 15 | fallow `health.maxCognitive` (unchanged) |
| parameters per function | — | 3 | review (clean-code skill) |

### Hard rules (cite by number in PR descriptions and reviews)

1. **Barrel-only entry.** Other modules import via `@/<module>` or a relative path that resolves to `<module>/index.ts`. Deep imports (resolving to `service.ts`, `repo.ts`, `internal/`, `jobs/`) from outside the module are forbidden — enforced by fallow `<module>-internal` zone.
2. **No raw drizzle outside `repo.ts`.** `service.ts` and `jobs/` call `repo.fn()`. Only `repo.ts` (or `repo/<file>.ts`) imports `drizzle-orm` and the schema.
3. **Own tables only in own `repo.ts`.** A module's `repo.ts` reads/writes only the tables that module owns. Reading another module's table = call the owner's barrel.
4. **Sync via `service.ts`, async via `events.ts` + `jobs/`.** No cross-module fire-and-forget via direct function calls. No cross-module DB writes through shared schema imports.
5. **`events.ts` is the published async contract.** Adding or changing event payload fields = changeset entry + semver bump for `@nama/server`.
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

### Typed wrapper around `jobs/` for events

The async contract is enforced by a thin typed wrapper added to `jobs/` (this is the previously-open Q4, now resolved into the design). The wrapper builds **fan-out on top of the existing single-handler `registerJob` API** without requiring any change to the job registry. The wrapper ships as three sibling files in `jobs/` (see Phase 2 decision below) — `emit.ts`, `on.ts`, and `event-name.ts` — re-exported by `jobs/events.ts` so consumers continue to write `import { emit, on } from "../jobs/events"`. Logical shape (single-file form for clarity):

```ts
// Combined view of jobs/{emit,on,event-name,events}.ts
import type { z } from "zod";

export type EventName = string & { readonly __brand: "EventName" };

const handlerLists = new Map<string, Array<(raw: unknown) => Promise<void>>>();

export async function emit<P>(name: EventName, schema: z.ZodType<P>, payload: P): Promise<void> {
  const validated = schema.parse(payload);    // fail-closed at enqueue
  await enqueue(name, validated);
}

export function on<P>(name: EventName, schema: z.ZodType<P>, handler: (payload: P) => Promise<void>): void {
  const validated = async (raw: unknown) => handler(schema.parse(raw));  // fail-closed at dispatch
  const existing = handlerLists.get(name);
  if (existing) {
    existing.push(validated);
    return;
  }
  const list: Array<(raw: unknown) => Promise<void>> = [validated];
  handlerLists.set(name, list);
  registerJob(name, async (raw) => {
    for (const h of list) {
      await h(raw);                           // sequential; first throw aborts the remaining handlers and the job runner retries the whole event.
    }
  });
}
```

**Phase 2 file split (cycle-break).** The wrapper was originally drafted as a single `jobs/events.ts` file. In implementation it caused a static import cycle — `jobs/runner.ts` (which emits `jobs.run.failed`) imports `emit`, while `on` imports `registerTriggerable` from `jobs/triggerable.ts`, which imports `run` from the runner. Fallow's `circular-deps: error` rule rejected the chain `events → triggerable → runner → events`. The wrapper therefore ships as four sibling files:

- `jobs/event-name.ts` — `EventName` brand only. Leaf with no imports.
- `jobs/emit.ts` — `emit` + the private `enqueue`. Imports only `./registry` (for `findEntry`).
- `jobs/on.ts` — `on` + the private `registerJob` + handler-list state. Imports `./triggerable`.
- `jobs/events.ts` — re-export barrel for the three above.

`runner.ts` imports `emit` directly from `./emit` (skipping the barrel) so the runner → emit edge no longer transits the file that imports `triggerable`. The public API is unchanged: modules write `import { emit, on } from "../jobs/events"` exactly as the single-file design specified. Recorded as Decision #10 below.

**Recursive-failure guard.** A `jobs.run.failed` handler's run is itself a job. If that handler-job fails (e.g. transient notifications DB outage), the runner would emit `jobs.run.failed` for the failed dispatcher and the next run would fail the same way — an unbounded chain. The runner therefore checks the failing job id against an internal `EVENT_DISPATCHER_JOB_IDS` set (currently `jobs.run.failed` + `jobs.sync.succeeded`) and skips `emitJobOutcome` for those. The same constraint applies to any future event whose dispatcher publishes via the typed bus.

Fan-out semantics:

- The first `on(...)` for an event registers a single dispatcher with `jobs/registry`; subsequent `on(...)` calls append to the in-memory handler list and rely on the already-registered dispatcher to invoke them. The job registry remains single-handler — the wrapper coordinates fan-out.
- Handlers run sequentially in registration order. If any handler throws, the dispatcher rethrows and the job runner records the failure / retries the whole event. This matches existing job retry semantics.
- A future variant (`onParallel`) for cases where handlers are independent is a follow-up, not in this design.

Modules use `emit` and `on` exclusively for cross-module signals. Raw `enqueue` and `registerJob` remain available for in-module scheduled work that has no public contract (e.g. a periodic sweep job).

### Async — events as jobs

`events.ts` declares event names and zod payload schemas. Emitters call `emit(...)` from `jobs/`; handlers register through `on(...)`.

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
import { emit } from "../jobs/events";
import { CATALOG_EVENTS, mediaAddedPayload } from "./events";

async addMedia(input: ...) {
  await this.repo.insert(input);
  await emit(CATALOG_EVENTS.MEDIA_ADDED, mediaAddedPayload, { mediaId, userId, occurredAt });
}
```

```ts
// notifications/jobs/on-catalog-media-added.ts (consumer)
import { on } from "../../jobs/events";
import { CATALOG_EVENTS, mediaAddedPayload } from "../../catalog";  // barrel — required; ../../catalog/events would be a deep import
import { getNotificationsService } from "..";

export function registerOnCatalogMediaAdded(): void {
  on(CATALOG_EVENTS.MEDIA_ADDED, mediaAddedPayload, async (payload) => {
    await getNotificationsService().notifyMediaAdded(payload);
  });
}
```

```ts
// notifications/jobs/index.ts
import { registerOnCatalogMediaAdded } from "./on-catalog-media-added";
// ...other handler registrations
export function registerJobs(): void {
  registerOnCatalogMediaAdded();
  // ...
}
```

```ts
// notifications/index.ts (barrel) re-exports registerJobs
export { registerJobs } from "./jobs";
```

Conventions:

- Event names: `<module>.<entity>.<verb-past-tense>`. Lower-kebab on each segment.
- Payloads validated by zod on enqueue and on dispatch.
- Handlers are idempotent. Job retry semantics already enforce this in `jobs/runner.ts`.
- Emitting fails-closed: if `events.ts` zod validation fails at enqueue, the calling sync operation rolls back.
- One event may have multiple handlers across modules. `registerJob` itself remains single-handler; multi-handler fan-out arrives the moment the typed `emit`/`on` wrapper lands (Phase 2, alongside the notifications exemplar). From then on, any module may call `on(EVENT, ...)` for an event already subscribed to elsewhere and both handlers run in registration order.

### Boot order

Handler registration must complete before any event fires. Two-stage boot, with **no top-level registration side effects**:

1. **Stage A (synchronous, deterministic):** `apps/server/src/index.ts` and `apps/server/src/worker.ts` call `<module>.registerJobs()` for every module in a fixed **alphabetical** order. Each module's barrel re-exports `registerJobs` from `<module>/jobs/index.ts`. The function imperatively invokes per-handler `register<X>()` functions, which in turn call `on(EVENT_NAME, schema, handler)`. No module performs registration at top-level import time. Alphabetical order is enforced by `boot.test.ts` so reordering cannot silently change handler precedence (which matters because handler fan-out is sequential — see §"Typed wrapper").
2. **Stage B (after Stage A):** the job runner begins polling and dispatching. Web routes accept requests.

Boot order rules:

- Each `<module>/jobs/<x>.ts` exports `export function register<X>(): void { on(EVENT, schema, handler); }`. No top-level `on(...)` calls.
- `<module>/jobs/index.ts` exports a single `registerJobs()` function that calls every per-handler `register<X>()` in order.
- `<module>/index.ts` re-exports `registerJobs` only — it does not re-export anything else from `jobs/`.
- `apps/server/src/{index,worker}.ts` import each module's barrel and call `module.registerJobs()`. Adding a new module = two lines added at each entry point.
- The boundaries test treats `apps/server/src/index.ts` and `apps/server/src/worker.ts` as the **only** files allowed to call `registerJobs` from another module's barrel. The deep-import rule (no `<module>/jobs/**` from outside the module) is unaffected because re-export goes through the barrel, not a deep import.
- `boot.test.ts` asserts that for every event name declared in any `<module>/events.ts`, calling all modules' `registerJobs()` (in a fresh process) results in at least one `on(...)` registration for that event. Catches "module added events.ts but never wired handler" regressions.

If the import graph between two modules' `events.ts` is acyclic but the event-flow graph is cyclic (A emits → B handles → B emits → A handles), that's allowed: events break the static import cycle. Document the runtime cycle in `events-and-jobs.md` with a sequence diagram so future readers don't introduce unbounded loops.

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

1. **Convention + review** in Phase 1 (this design).
2. **Pre-commit script** also in Phase 1: see "Ownership pre-commit script" below.
3. **Per-module schema namespaces** in Phase 4 (deferred): split `db/schema/` into `db/schema/<module>/`, give each module a fallow rule that allows only its own schema subpath.

Phase 1 ships options 1 and 2 together — convention alone is not load-bearing because the script catches violations. Option 3 is a follow-up spec.

### Ownership pre-commit script (Phase 1)

A small Node script under `tools/check-table-ownership.ts`:

1. Walk `apps/server/src/db/schema/**/*.ts`. For each file, scan top-of-file comments for `@owner: <module>` directives. Each directive owns every drizzle table declared in that file. Multi-table-per-file is allowed only when all tables share an owner; mixing requires a per-export directive (`// @owner(tableName): <module>`).
2. Build a map `tableExportName → owningModule`.
3. Walk `apps/server/src/<module>/**/*.ts`. For every named import from `@/db/schema` (or relative path resolving to it), assert the imported name's owner matches `<module>`, OR the importing file is `<module>/repo.ts` / `<module>/repo/**`.
4. TS path aliases (`@/...`) and relative paths normalized by resolving against `tsconfig.json` `paths`.
5. Exit code 1 on violations; printed list of `<file>:<line>: imports <table> owned by <other-module>`.

Script lives in `tools/`; wired into `vp staged` and CI. ~150 LOC, AST parsing via `ts-morph` if already declared in `apps/server/package.json`, otherwise via the TypeScript compiler API. The Phase 1 spike confirms the dependency choice and the same library is reused by `boundaries.test.ts` to avoid duplicate AST plumbing.

### Goal-language correction

Goal 4 ("Each module owns its drizzle tables; other modules cannot query them directly") is enforced from Phase 1 via the pre-commit script above. The Phase 4 namespace split is a *structural* tightening on top of that enforcement, not the only line of defense.

### Drizzle migration scope

Migrations stay in `apps/server/drizzle/` and remain global. Per-module migrations are out of scope (would block running web + worker as one Node process). Ownership is enforced at the read-write boundary only.

## Fallow boundaries

### Replace `server-domains` and `server-infra` mega-zones

Today (`.fallowrc.json` lines 180–205):

```json
{ "name": "server-domains", "patterns": [".../artwork/**", ".../auth/**", ...one bucket for seven domains... ] },
{ "name": "server-infra",   "patterns": [".../db/**", ".../cache/**", ".../crypto/**", ".../connections/**", ".../diagnostics/**" ] },
```

Replace with per-module zones plus `-internal` sub-zones. **No negated globs are required** — fallow's `BoundaryZone` schema documents *"A file belongs to the first zone whose pattern matches."* So listing the narrower zone first and the broader one immediately after gives the desired split:

```jsonc
// Order matters. Public zone listed first (matches only index.ts); internal listed second (catches the rest).
{ "name": "server-mod-artwork",         "patterns": ["apps/server/src/artwork/index.ts"] },
{ "name": "server-mod-artwork-internal","patterns": ["apps/server/src/artwork/**"] },

{ "name": "server-mod-auth",            "patterns": ["apps/server/src/auth/index.ts"] },
{ "name": "server-mod-auth-internal",   "patterns": ["apps/server/src/auth/**"] },

// ... same shape for catalog, home, media, notifications, preferences, plugin-runtime

// infra (jobs included), one zone, locked down
{ "name": "server-infra", "patterns": [
    "apps/server/src/db/**",
    "apps/server/src/cache/**",
    "apps/server/src/crypto/**",
    "apps/server/src/connections/**",
    "apps/server/src/diagnostics/**",
    "apps/server/src/jobs/**"
] },

// adapters
{ "name": "server-api", "patterns": ["apps/server/src/api/**"] },
{ "name": "server-mcp", "patterns": ["apps/server/src/mcp/**"] }
```

Verified mechanism: fallow 2.54.3 in this repo (`fallow config-schema`) documents first-match-wins zone membership. A Phase 1 spike on `preferences/` (the smallest module) validates this on the actual codebase before the rest land.

### Rules (the boundary contract)

For each module `<x>`:

```jsonc
{
  "from": "server-mod-<x>",
  "allow": [
    "server-mod-<x>-internal",
    "server-infra",
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
    "server-mod-<other>",     // OK to import another module's barrel from internal too
    "shared-pkg",
    "plugin-sdk"
  ]
}
```

(`jobs/` is part of `server-infra` so it doesn't need a separate entry in the allow list. Note: `jobs/` as referenced here is the **top-level** `apps/server/src/jobs/` infra directory. Each module's own `<module>/jobs/**` is part of `server-mod-<x>-internal`, not `server-infra` — only the module itself imports from its own `jobs/` subdirectory.)

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
{ "from": "server-mod-plugin-runtime",          "allow": [...standard module allow list..., "plugins"] },
{ "from": "server-mod-plugin-runtime-internal", "allow": [...standard module allow list..., "plugins"] }
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
| `frontend-feature-architecture` | Full-stack PR with both `apps/server/` and `apps/client/` changes | Sibling skill; ensures both halves of a vertical slice follow their respective standards |

Skip frontend-specific render/UI skills (`vercel-react-*`, `shadcn`, `web-design-guidelines`, `vercel-composition-patterns`, `vercel-react-view-transitions`, `paraglide-js`).

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

### Phase 1 — Boundary scaffolding (single PR, or split into 1a + 1b if PR exceeds ~40 files)

- Spike: validate first-match-wins on `preferences/` with both zone shapes in `.fallowrc.json`. Lock spike result into the design notes.
- Split `.fallowrc.json` `server-domains` mega-zone into 8 per-module zones + 8 `-internal` sub-zones (`jobs/` rolls into `server-infra`).
- Lock `server-infra` allow list to `shared-pkg` + `plugin-sdk` only.
- Add zone rules per the contract above.
- Fix the **trivial** cross-module deep imports flagged by fallow: every case that becomes a one-line barrel re-export (types, errors, factory accessors). Approximately 50 of the 71 (see Appendix A breakdown for the non-trivial subset).
- **Defer to Phase 2 / Phase 3**: cross-module imports that require converting a function call into an event (`notifications/emit` ×3, plus any other case where source and consumer modules both need code changes). These are listed in Phase 2 (for notifications) and Phase 3 (per source module).
- Phase 1 carries 14 tagged `fallow-allow` suppressions: 3 `phase-2 event conversion` imports (`plugin-runtime/context.ts`, `jobs/runner.ts`, `media/connection-lifecycle.ts`) and 11 `phase-2 infra-to-module decoupling` imports (`connections/auth.ts`, `connections/helpers.ts`, `connections/service.ts` ×2, `db/seed.ts`, `jobs/plugin-jobs.ts`, `jobs/scheduler.ts` ×5). Every suppression keeps the adjacent two-line `fallow-allow` then `fallow-ignore-next-line` pattern so the deferred debt stays grepable.
- Add file-size pre-commit script under `tools/check-file-sizes.ts`.
- Add table-ownership pre-commit script under `tools/check-table-ownership.ts`. Phase 1 also lands the `@owner:` annotations on every drizzle schema file.
- `tools/**` remains excluded from type-aware lint until a dedicated tools `tsconfig.json` lands; the scripts still run directly through `vp staged` and CI.

Exit criteria: `vp check`, `vp test`, `fallow dead-code`, `fallow health` all green. Allowlist limited to the 14 tagged Phase 1 deferrals above, each tracked in the Phase 2/3 plan. `tools/check-table-ownership.ts` green.

### Phase 2 — Skill + exemplar (single PR)

- Refactor `notifications/` to the new shape: extract `repo.ts` from `repos.ts`, declare `events.ts` with current emit points (`emit.ts` → restructure), formalize `internal/` for `resolve-recipients.ts`, `delivery-policy.ts`, etc.
- Write `.agents/skills/backend-feature-architecture/SKILL.md` + references + symlink.
- Reference `notifications/` from the skill as canonical example.
- Add the changeset entry for `@nama/server` (minor — public surface of `notifications/` changed).

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

(`jobs/` is infra and gets no retrofit beyond Phase 2's typed `emit`/`on` wrapper.)

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

Estimates are calibrated to "PR-shape work including design of file splits, not just mechanical moves." `service.ts` files >25 KB carry an extra 1.5× factor for the responsibility design.

| Module | Files now | LOC of largest file | Effort (engineer-days, est.) |
|---|---|---|---|
| `preferences/` | 3 | small | 0.5 |
| `auth/` | 7 | medium | 1.5 |
| `artwork/` | 5 | small | 1.0 |
| `catalog/` | 9 | `service.ts` 20.9 KB | 2.0 |
| `notifications/` | 9 (+ templates/) | `repos.ts` 19.7 KB | 1.5 (exemplar PR; includes skill authoring) |
| `home/` | 13 | `orchestrator.ts` 12.5 KB | 2.5 |
| `media/` | 17 | `service.ts` 32.5 KB | 4.5 |
| `plugin-runtime/` | 11 | `runtime.ts` 31.8 KB | 3.0 |
| **Total (Phase 2 + 3)** | | | **~16.5 engineer-days** |

Phase 1 adds ~1.5 engineer-days for the zone split + 71 import fixes + ownership script. Phase 4 (deferred) is its own spec.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Fallow does not support per-zone health budgets | Tighten project-wide to 15; exempt adapters via `health.ignore` patterns. |
| Fallow boundary trick (root vs `-internal` zone) depends on documented first-match-wins ordering, not negated patterns | Schema verified in iteration 2; spike on `preferences/` in Phase 1 is the final smoke test before splitting the remaining seven. Fall back to convention + grep pre-commit if behavior diverges from schema. |
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
  - `index.ts` re-exports come from the module's own `service.ts` (class + factory accessor), `events.ts`, `errors.ts`, and `types.ts` only. The test allows function/const accessors (e.g. `getCatalogService`) provided they're declared in or re-exported from `service.ts`; it bans re-exports of `repo.ts`, `jobs/**`, or `internal/**`.
  - No file outside the module references `<module>/repo.ts`, `<module>/internal/**`, or `<module>/jobs/**`. The check resolves TS path aliases via `tsconfig.json` `paths` and runs against the real import graph (not text grep) using the TypeScript compiler API or `ts-morph`.
  - Pre-commit hook executes the same checks faster against changed files only.
  - **Phase 2 implementation note**: the shipped `boundaries.test.ts` uses regex scanning over raw file content, both for `import "../<module>/..."` deep paths and the `@/<module>/...` alias variants. Fallow is the authoritative boundary enforcer; the test is a fast secondary check. Migrating to `ts-morph` (per the bullet above) is a Phase 3 improvement so the alias-resolution gap closes deterministically.
- Boot test: `apps/server/src/__tests__/boot.test.ts` asserts every event declared in any `<module>/events.ts` has at least one `on(...)` reachable from `apps/server/src/index.ts` and `apps/server/src/worker.ts`.
- Smoke: `vp test` runs all server tests; CI runs `fallow dead-code --format json --quiet 2>/dev/null || true` and fails on any boundary violation (`boundary_violations` > 0).
- Per project memory guardrails #8 and #9, every commit in this work must pass `vp check` and `vp test`.

## Success criteria

1. `.fallowrc.json` contains 8 `server-mod-<x>` zones + 8 `server-mod-<x>-internal` zones; `server-domains` is removed; `jobs/` is folded into `server-infra`.
2. `fallow dead-code --format json` reports `boundary_violations: 0` on `main`.
3. Every module has `index.ts`, `service.ts`, `repo.ts` (if it touches DB), `errors.ts`, `types.ts`, and `__tests__/`.
4. `notifications/` matches the canonical layout exactly; the boundaries test (above) asserts this.
5. `.agents/skills/backend-feature-architecture/SKILL.md` exists, is symlinked into `.claude/skills/`, and is referenced from `apps/server/CLAUDE.md` (or root `CLAUDE.md` Frontend Skills block extended with a Backend Skills block).
6. Cross-module imports resolve only to `<module>/index.ts`. Verified by fallow's import-graph analysis (not text grep — handles TS path aliases correctly).
7. Each owned drizzle table has an `@owner:` directive in its schema file matching the module that imports it in `repo.ts`. `tools/check-table-ownership.ts` exits 0 in CI.
8. No new `utils.ts`, `helpers.ts`, or `misc.ts` files in modules (pre-commit rule).
9. Documentation: `CLAUDE.md` extended with backend skill block mirroring the frontend block; this design doc committed at `docs/2026-05-17-backend-feature-architecture-design.md`.
10. `boundaries.test.ts` and `boot.test.ts` both pass in `vp test`.

## Open questions

1. **Per-zone fallow health budgets** — fallow's `health` config is project-wide today. Decision: tighten project-wide to `maxCyclomatic: 15`, and add `apps/server/src/api/**` + `apps/server/src/mcp/**` to `health.ignore`. Validated in Phase 1 spike.
2. ~~**Negated pattern support in fallow zones**~~ — **resolved**: fallow's `BoundaryZone` schema documents first-match-wins membership. The narrower zone listed first + the broader zone second yields the desired barrel/internal split without negation. Verified against `fallow config-schema` output. Phase 1 spike on `preferences/` is the final smoke test. **Spike outcome (2026-05-17, fallow 2.54.3):** with `server-mod-preferences` (pattern `apps/server/src/preferences/index.ts`) listed before `server-mod-preferences-internal` (pattern `apps/server/src/preferences/**`), `fallow list --boundaries --format json` reports `file_count: 1` on the narrower zone (just `index.ts`) and `file_count: 23` on the broader zone (remaining 23 files), with `server-domains` correctly losing the 24 preferences files. First-match-wins confirmed; PAT-002 ordering is sound.
3. ~~**`@owner:` directive parser**~~ — **resolved**: use `ts-morph` if already in the repo, otherwise the TS compiler API directly. Hand-rolled regex rejected (cannot handle multi-line directives or named exports).
4. ~~**`jobs/` API surface for events**~~ — **resolved**: typed `emit(name, schema, payload)` and `on(name, schema, handler)` defined in §"Typed wrapper around `jobs/` for events" above.

## Rollout

- Phase 1 PR: `server-mod-* zones + cross-module deep-import cleanup`. Reviewer: at least one server lead.
- Phase 2 PR: `notifications/ retrofit + backend-feature-architecture skill`. Reviewer: same as Phase 1.
- Phase 3 PRs: one per module. Each PR includes a changeset entry (per `CLAUDE.md` Pull Requests and Versioning section).
- Communication: post in #engineering when Phase 1 lands; require reviewers to cite Rule numbers when blocking PRs on boundary issues.

## Appendix A — Full survey of cross-module deep imports (Phase 1 scope)

Generated by `grep -rEh 'from "\.\./(artwork|auth|catalog|home|media|notifications|preferences|plugin-runtime|jobs)/[a-z][^"]*"' apps/server/src --include='*.ts'` on 2026-05-17 against `main`. 71 total occurrences, grouped by target.

Group totals sum to 71. `jobs/` is included as an "import target" but is infra, so its 9 occurrences become legal infra imports after Phase 1 and require no source fix.

**plugin-runtime (21)**
- `../plugin-runtime/runtime` ×8
- `../plugin-runtime/registry` ×8
- `../plugin-runtime/shared-credentials` ×2
- `../plugin-runtime/loader` ×1
- `../plugin-runtime/host-bridge` ×1
- `../plugin-runtime/allowed-hosts` ×1

**catalog (11)**
- `../catalog/types` ×5
- `../catalog/canonical` ×3
- `../catalog/jobs/recommendation-build` ×1
- `../catalog/jobs` ×1
- `../catalog/features` ×1

**media (14)**
- `../media/service` ×3
- `../media/errors` ×3
- `../media/dispatcher` ×3
- `../media/strategies/aggregate-per-kind` ×1
- `../media/resolve-connection` ×1
- `../media/parse-item` ×1
- `../media/invoke` ×1
- `../media/capability-lookup` ×1

**notifications (6)**
- `../notifications/emit` ×3
- `../notifications/stale-pending-sweep` ×1
- `../notifications/demo-job` ×1
- `../notifications/delivery-job` ×1

**preferences (4)**
- `../preferences/provider` ×2
- `../preferences/types` ×1
- `../preferences/jobs` ×1

**auth (4)**
- `../auth/permissions` ×1
- `../auth/oauth-metadata` ×1
- `../auth/oauth-handler` ×1
- `../auth/config` ×1

**home (1)**
- `../home/jobs/layout-warm` ×1

**artwork (1)**
- `../artwork/service` ×1

**jobs (9)** — these become infra-style imports after Phase 1, no fix needed
- `../jobs/triggerable` ×3
- `../jobs/registry` ×2
- `../jobs/types` ×1
- `../jobs/scheduled` ×1
- `../jobs/scheduled-per-row` ×1
- `../jobs/coalesced` ×1
- (one `../jobs/...` deep import not de-duped above; full grep is reproducible from the command in the appendix header.)

Phase 1 PR converts every domain target above to a barrel re-export. For each, the destination is one of:

1. **Re-export from `index.ts`** — for types, classes, factory accessors that genuinely belong in the public surface (e.g. `MediaService`, `AllPluginsFailedError`, `CanonicalMedia` types). Temporary job-function exports such as `catalog.writeRecommendationsForUser` and `home.registerHomeLayoutWarmJob` are Phase 3 cleanup items, not permanent public API.
2. **Move under `internal/`** — for helpers consumers were using because there was no public alternative (e.g. `parse-item`, `aggregate-per-kind`); replace the consumer's call with a barrel-exported method.
3. **Convert to event consumer** — for the `notifications/emit` calls from other modules: those become `on(...)` registrations in `notifications/jobs/` for events the source module now emits, rather than direct cross-module function calls.

The 8 `jobs/` deep imports are not violations after Phase 1 — `jobs/` is infra; deep imports into infra are allowed (modules import `db/schema/x`, `cache/foo`, etc. routinely).

## Appendix B — Frontend skill stats (for symmetry reference)

`.agents/skills/frontend-feature-architecture/` (as of 2026-05-17):

| File | Lines |
|---|---|
| `SKILL.md` | 106 |
| `references/folder-layout.md` | 171 |
| `references/react-query.md` | 167 |
| `references/composition.md` | 148 |
| `references/data-layer.md` | 140 |
| `references/i18n-and-tokens.md` | 102 |
| `references/checklist.md` | 58 |
| **Total** | **892** |

`backend-feature-architecture` targets a comparable envelope, slightly larger to absorb 3 worked examples (`new-module.md`, `add-event.md`, `retrofit-existing.md`) that the frontend skill does not have: `SKILL.md` ≤ 220 lines, total ≤ 1000 lines across SKILL.md + 6 references + 3 example files. Line-count rule: physical lines in the file (frontmatter included, code-block contents counted). Trailing blank lines excluded.

## Appendix C — Example new module (skeleton)

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
