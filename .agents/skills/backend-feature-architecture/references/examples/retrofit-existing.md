# Example: retrofit drifted module → canonical shape

Worked retrofit of `media/` (largest module, hardest case). Same procedure scales down.

## Pre-state (today)

```
apps/server/src/media/
├── service.ts                  # 32.5K — TOO BIG
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

Issues: no `index.ts`, no `repo.ts`, no `events.ts`, `service.ts` over hard cap, no `internal/`, consumers deep-import `dispatcher`, `service`, `errors`.

## Step 1: inventory + map roles

| Current file | Role | Target |
|---|---|---|
| `service.ts` | sync API + impl, mixed | split into `service/` |
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

If `service.ts` (or any helper) calls drizzle direct → move those calls to new `repo.ts`. `service/*.ts` now calls `repo.fn()`.

```ts
// media/repo.ts
// @owner-touching: media (assumes media owns its tables)
import { db } from "../db";
import { dispatchCache } from "../db/schema/media";   // @owner: media
// ...
export class MediaRepo {
  async upsertDispatch(...): Promise<...> { /* drizzle calls */ }
  async getDispatchCache(...): Promise<...> { /* ... */ }
}
```

R2 satisfied: drizzle ONLY in `repo.ts`.

## Step 3: split `service.ts` → `service/`

```
media/service/
├── index.ts            # re-exports public methods
├── dispatch.ts         # MediaService.dispatch(...)
├── invoke.ts           # MediaService.invoke(...)
├── id-resolver.ts      # MediaService.resolveId(...)
└── lifecycle.ts        # MediaService.connect/disconnect
```

```ts
// media/service/index.ts
export { MediaService, getMediaService } from "./impl";
```

Or compose:

```ts
// media/service/impl.ts
import { dispatchImpl } from "./dispatch";
import { invokeImpl } from "./invoke";
// ...

export class MediaService {
  constructor(private repo: MediaRepo) {}
  dispatch = (...a) => dispatchImpl(this.repo, ...a);
  invoke = (...a) => invokeImpl(this.repo, ...a);
  // ...
}
```

Each `service/<x>.ts` < hard cap (200 LOC target soft).

## Step 4: move helpers → `internal/`

```bash
git mv parse-item.ts internal/
git mv capability-lookup.ts internal/
# ...
```

Update relative imports inside `service/` to `../internal/<x>`.

R8 satisfied: `internal/` private; fallow `-internal` zone blocks outside import.

## Step 5: declare `events.ts` if media emits

If media has cross-mod side-effects (e.g. "dispatch succeeded" → analytics):

```ts
// media/events.ts
export const MEDIA_EVENTS = {
  DISPATCH_SUCCEEDED: "media.dispatch.succeeded",
  DISPATCH_FAILED: "media.dispatch.failed",
} as const;
// + zod schemas
```

Migrate any existing direct cross-mod calls → `emit(...)`.

If no cross-mod signals → skip `events.ts`.

## Step 6: jobs wrapping (R7)

If media has handlers (today maybe none) → standard `jobs/<x>.ts` + `jobs/index.ts` with `registerJobs()`. Else create empty `jobs/index.ts`:

```ts
// media/jobs/index.ts
export function registerJobs(): void {}
```

So entry-point wiring works uniformly.

## Step 7: write barrel

```ts
// media/index.ts
export { MediaService, getMediaService } from "./service";
export * from "./events";                    // if exists
export * from "./errors";
export type * from "./types";
export { registerJobs } from "./jobs";
```

NO re-export `repo`, `internal`, `service/<x>`, `jobs/<x>`.

R1 + R10 satisfied.

## Step 8: fix consumer imports

Grep:

```bash
grep -rn 'from "..*/media/[a-z]' apps/server/src --include='*.ts' | grep -v media/__tests__
```

Each hit → rewrite to barrel:

```ts
// before
import { MediaService } from "../media/service";
import { AllPluginsFailedError } from "../media/errors";
import { dispatcher } from "../media/dispatcher";   // helper — was leaking

// after
import { MediaService, AllPluginsFailedError } from "../media";
// "dispatcher" was internal — call via service method instead:
import { getMediaService } from "../media";
const result = await getMediaService().dispatch(...);
```

If consumer needs something the barrel doesn't expose → add to barrel (extend `service` method) in SAME PR.

## Step 9: wire entry points

```ts
// apps/server/src/index.ts + worker.ts (alphabetical)
import * as media from "./media";
// ...
media.registerJobs();   // alphabetical position
```

## Step 10: enable boundaries test

Remove any `boundaries.test.ts` skip for `media/`:

```ts
const MODULES = ["artwork", "auth", "catalog", "home", "media", "notifications", "preferences", "plugin-runtime"];
```

Run. MUST pass.

## Step 11: verify

```bash
vp check && vp test
fallow dead-code --format json --quiet 2>/dev/null | jq '.boundary_violations'   # []
node tools/check-table-ownership.ts
node tools/check-file-sizes.ts
```

Expect: zero violations.

## Step 12: changeset

```md
---
"@ent-mcp/server": minor
---

Restructured media to flat-with-reserved-files layout; public API unchanged.
```

`minor` if barrel surface changed (added re-export). `patch` if pure refactor + same surface. Empty frontmatter if no public-facing change.

## Smaller modules

Same procedure, fewer steps:

- No `repo.ts` if module touches no DB.
- No `service/` split if `service.ts` < 500 LOC.
- No `events.ts` if no cross-mod signals.
- No `jobs/` if no handlers — still create `jobs/index.ts` with empty `registerJobs()` for uniform wiring.

## Anti-patterns to avoid mid-retrofit

- **"While I'm here" cleanup** outside the module. Surgical (Rule 3 of `CLAUDE.md`).
- Renaming public method names → breaks consumers silently. Keep names; only restructure files.
- Mixing event introduction with retrofit. Land structure first; events in follow-up PR if non-trivial.
- Junk-drawer rename (`helpers.ts`, `utils.ts`, `misc.ts`) → R11.

## See

- [`module-layout.md`](../module-layout.md)
- [`checklist.md`](../checklist.md) — Retrofit section
