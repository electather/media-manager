# Fallow zones

Static enforcement of barrel/internal boundary.

## Mechanism

Fallow `BoundaryZone`: file belongs to first zone whose pattern matches. First-match-wins = what we need.

Per module `<x>`:

```
zones (narrow first):
  server-mod-<x>           → apps/server/src/<x>/index.ts
  server-mod-<x>-internal  → apps/server/src/<x>/**
```

`<x>/index.ts` → first zone. Everything else under `<x>/**` → `-internal`. No negated globs.

## Per-module rules

```
from server-mod-<x>:
  allow: [<x>-internal, server-infra, server-mod-<other>, shared-pkg, plugin-sdk]

from server-mod-<x>-internal:
  allow: [<x>, <x>-internal, server-infra, server-mod-<other>, shared-pkg, plugin-sdk]
```

Key: no rule allows `<x>-internal` to be imported from `<y>` or `<y>-internal` when `y≠x`. Barrel-only entry guaranteed.

## Adapter rules

```
from server-api: allow [server-mod-*, server-infra, shared-pkg, plugin-sdk, server-mcp]
from server-mcp: allow [server-mod-*, server-infra, shared-pkg, plugin-sdk]
```

Adapters → barrels only. Modules never list `server-api`/`server-mcp` in allow.

## Infra rules

```
from server-infra: allow [shared-pkg, plugin-sdk]
```

Infra (`db/ cache/ crypto/ connections/ diagnostics/ jobs/`) MUST NOT import any module → reverse dep.

## `jobs/` carve-out

Top-level `apps/server/src/jobs/**` → `server-infra`. Modules import like any infra.

`<module>/jobs/**` → part of `server-mod-<x>-internal`. Only same-module files may import. Entry points reach module jobs via barrel's `registerJobs` re-export, never deep import.

## Plugins

```
from server-mod-plugin-runtime:          allow [...standard, plugins]
from server-mod-plugin-runtime-internal: allow [...standard, plugins]
```

`plugins` (`packages/plugins/**`) flows only into `plugin-runtime`. Other modules: no direct plugin pkg refs.

## Severity

```
unused-files:   error
unused-exports: error
unused-types:   warn
unused-deps:    warn
circular-deps:  error
```

Boundary violations always `error`. Phase 1 PR fixes same change as zone split — no warn-window.

## Health budgets

```
maxCyclomatic: 15
maxCognitive:  15
maxCrap:       30
ignore: [apps/server/src/api/**, apps/server/src/mcp/**, **/*.test.ts, **/*.spec.ts, packages/plugins/**]
```

`maxCyclomatic: 15` for module code (lowered from project default 20). Adapters ignored — Hono + MCP handlers legitimately higher branching.

## Running fallow locally

```bash
# check boundary violations
fallow dead-code --format json --quiet 2>/dev/null | jq '.boundary_violations'
# returns [] when clean

# check complexity
fallow health --format json --quiet 2>/dev/null | jq '.functions[] | select(.cyclomatic > 15)'
```

## Adding a new module

```
1. create apps/server/src/<new>/ w/ canonical layout → module-layout.md
2. add 2 zones to .fallowrc.json (narrow first)
3. add 2 rules (from: server-mod-<new> + from: server-mod-<new>-internal) w/ std allow list
4. update other modules' rules if they consume new module (or use wildcard)
5. update server-api + server-mcp allow lists if adapters call module
6. wire <new>.registerJobs() into {index,worker}.ts alphabetically
7. fallow dead-code → confirm clean
```

## See also

- [module-layout.md](module-layout.md) — what each zone protects
- [events-and-jobs.md](events-and-jobs.md) — why `<module>/jobs/**` is `-internal` not infra
- [db-ownership.md](db-ownership.md) — parallel enforcement for tables
