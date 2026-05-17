# Example: retrofit drifted module → canonical shape

Worked retrofit of `media/` (largest module, hardest case). Procedure scales down.

## Pre-state (today)

```
apps/server/src/media/
├── service.ts          # 32.5K — TOO BIG
├── dispatcher.ts
├── dispatch-cache.ts
├── invoke.ts
├── id-resolver.ts
├── parse-item.ts
├── capability-lookup.ts
├── resolve-connection.ts
├── connection-lifecycle.ts
├── connection-targeted.ts
├── primary-preference.ts
├── compact.ts
├── cache.ts
├── service-id.ts
├── errors.ts
├── types.ts
├── strategies/
└── __tests__/
```

Issues: no `index.ts`, no `repo.ts`, no `events.ts`, `service.ts` over hard cap, no `internal/`, consumers deep-import `dispatcher`/`service`/`errors`.

## Step 1: inventory + map roles

| Current file | Role | Target |
|---|---|---|
| `service.ts` | sync API + impl, mixed | split → `service/` |
| `dispatcher.ts` | dispatch logic | `service/dispatch.ts` |
| `invoke.ts` | invoke logic | `service/invoke.ts` |
| `id-resolver.ts` | resolve logic | `service/id-resolver.ts` |
| `parse-item.ts` | helper, no public surface | `internal/parse-item.ts` |
| `capability-lookup.ts` | helper | `internal/capability-lookup.ts` |
| `resolve-connection.ts` | helper | `internal/resolve-connection.ts` |
| `dispatch-cache.ts` | helper | `internal/dispatch-cache.ts` |
| `cache.ts` | helper | `internal/cache.ts` |
| `connection-*.ts`, `primary-preference.ts`, `compact.ts`, `service-id.ts` | helpers | `internal/<x>.ts` |
| `strategies/` | helpers | `internal/strategies/` |
| `errors.ts` | typed errors | keep at root |
| `types.ts` | public types | keep at root |
| (none) | DB queries | new `repo.ts` if any |

## Step 2: extract `repo.ts`

```
// media/repo.ts
// @owner: media (assumes media owns its tables)
import { db, dispatchCache } from drizzle + db/schema/media

class MediaRepo:
  upsertDispatch(...) → ...
  getDispatchCache(...) → ...
```

R2 satisfied: drizzle ONLY in `repo.ts`.

## Step 3: split `service.ts` → `service/`

```
media/service/
├── index.ts       # re-exports public methods
├── dispatch.ts    # MediaService.dispatch(...)
├── invoke.ts      # MediaService.invoke(...)
├── id-resolver.ts # MediaService.resolveId(...)
└── lifecycle.ts   # MediaService.connect/disconnect

// service/impl.ts (composition pattern)
class MediaService(repo):
  dispatch = (...a) → dispatchImpl(repo, ...a)
  invoke   = (...a) → invokeImpl(repo, ...a)
```

Each `service/<x>.ts` < hard cap (200 LOC soft target).

## Step 4: move helpers → `internal/`

```bash
git mv parse-item.ts internal/
git mv capability-lookup.ts internal/
# ...
```

Update relative imports inside `service/` → `../internal/<x>`.

R8 satisfied: `internal/` private; fallow `-internal` zone blocks outside import.

## Step 5: declare `events.ts` if media emits

```
// media/events.ts (if cross-mod side effects exist)
MEDIA_EVENTS = {
  DISPATCH_SUCCEEDED: "media.dispatch.succeeded",
  DISPATCH_FAILED:    "media.dispatch.failed",
} as const
// + zod schemas

migrate existing direct cross-mod calls → emit(...)
```

If no cross-mod signals → skip `events.ts`.

## Step 6: jobs wrapping (R7)

```
// media/jobs/index.ts
// if no handlers yet:
export fn registerJobs(): void {}
// (uniform entry-point wiring requires registerJobs to always exist)
```

## Step 7: write barrel

```
// media/index.ts
export { MediaService, getMediaService } from "./service"
export * from "./events"    // if exists
export * from "./errors"
export type * from "./types"
export { registerJobs } from "./jobs"
// NO: repo, internal, service/<x>, jobs/<x>
```

R1 + R10 satisfied.

## Step 8: fix consumer imports

```bash
grep -rn 'from "..*/media/[a-z]' apps/server/src --include='*.ts' | grep -v media/__tests__
```

Each hit → rewrite to barrel:

```
// before
import { MediaService } from "../media/service"
import { AllPluginsFailedError } from "../media/errors"
import { dispatcher } from "../media/dispatcher"      // internal — was leaking

// after
import { MediaService, AllPluginsFailedError, getMediaService } from "../media"
result = await getMediaService().dispatch(...)         // dispatcher now behind service method
```

If consumer needs something barrel doesn't expose → add to barrel in SAME PR.

## Step 9: wire entry points

```
// index.ts + worker.ts (alphabetical)
import * as media from "./media"
media.registerJobs()   // alphabetical position
```

## Step 10: enable boundaries test

```
// remove any skip for media/ in boundaries.test.ts
MODULES = ["artwork","auth","catalog","home","media","notifications","preferences","plugin-runtime"]
```

Run. MUST pass.

## Step 11: verify

```bash
vp check && vp test
fallow dead-code --format json --quiet 2>/dev/null | jq '.boundary_violations'  # []
node tools/check-table-ownership.ts
node tools/check-file-sizes.ts
```

## Step 12: changeset

```md
---
"@ent-mcp/server": minor
---

Restructured media to flat-with-reserved-files layout; public API unchanged.
```

`minor` if barrel surface changed. `patch` if pure refactor + same surface. Empty frontmatter if no public-facing change.

## Smaller modules

```
no DB touch       → skip repo.ts
service.ts < 500  → skip service/ split
no cross-mod sig  → skip events.ts
no handlers       → still create jobs/index.ts w/ empty registerJobs() for uniform wiring
```

## Anti-patterns mid-retrofit

- "While I'm here" cleanup outside module. **Surgical (CLAUDE.md Rule 3)**
- Rename public method names → breaks consumers silently. Keep names; only restructure files
- Mix event introduction with retrofit. Land structure first; events in follow-up PR if non-trivial
- Junk-drawer rename (`helpers/utils/misc.ts`) → R11

## See also

- [../module-layout.md](../module-layout.md)
- [../checklist.md](../checklist.md) — Retrofit section
