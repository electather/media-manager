# Fallow zones

How the barrel/internal boundary is enforced statically.

## Mechanism

Fallow's `BoundaryZone` schema documents: *"A file belongs to the first zone whose pattern matches."* This first-match-wins ordering is exactly what we need.

For each module `<x>`:

```jsonc
// .fallowrc.json — order matters: narrower listed first.
{ "name": "server-mod-<x>",          "patterns": ["apps/server/src/<x>/index.ts"] },
{ "name": "server-mod-<x>-internal", "patterns": ["apps/server/src/<x>/**"] }
```

`<x>/index.ts` matches the first zone and falls there. Every other file under `<x>/**` falls into `-internal`. No negated globs.

## Per-module rules

```jsonc
{
  "from": "server-mod-<x>",
  "allow": [
    "server-mod-<x>-internal",
    "server-infra",
    "server-mod-<other>",     // other modules' BARRELS only
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
    "server-mod-<other>",
    "shared-pkg",
    "plugin-sdk"
  ]
}
```

Key property: **no rule allows `<x>-internal` to be imported from `<y>` or `<y>-internal`** when `y ≠ x`. That's the barrel-only entry guarantee.

## Adapter rules

```jsonc
{ "from": "server-api", "allow": ["server-mod-*", "server-infra", "shared-pkg", "plugin-sdk", "server-mcp"] },
{ "from": "server-mcp", "allow": ["server-mod-*", "server-infra", "shared-pkg", "plugin-sdk"] }
```

Adapters call module **barrels** only. Modules never have `server-api` or `server-mcp` in their allow lists.

## Infra rules

```jsonc
{ "from": "server-infra", "allow": ["shared-pkg", "plugin-sdk"] }
```

Infra (`db/`, `cache/`, `crypto/`, `connections/`, `diagnostics/`, `jobs/`) imports from `shared-pkg` and `plugin-sdk` only. Infra MUST NOT import from any module — that would be a reverse dependency.

## `jobs/` carve-out

Top-level `apps/server/src/jobs/**` is part of `server-infra`. Modules import from it like any other infra.

A module's own `<module>/jobs/**` is NOT in `server-infra` — it's part of `server-mod-<x>-internal`, which means only files within the same module may import from it. The entry-point files (`apps/server/src/index.ts`, `worker.ts`) reach module jobs through the barrel's `registerJobs` re-export, never via a deep import.

## Plugins

```jsonc
{ "from": "server-mod-plugin-runtime",          "allow": [/* standard */, "plugins"] },
{ "from": "server-mod-plugin-runtime-internal", "allow": [/* standard */, "plugins"] }
```

`plugins` (`packages/plugins/**`) flows only into `plugin-runtime`. Other modules don't reference plugin packages directly.

## Severity

```jsonc
"rules": {
  "unused-files":   "error",
  "unused-exports": "error",
  "unused-types":   "warn",
  "unused-deps":    "warn",
  "circular-deps":  "error"
}
```

Boundary violations are always `error`. Phase 1 PR fixes them in the same change as the zone split — no warn-window.

## Health budgets

```jsonc
"health": {
  "maxCyclomatic": 15,
  "maxCognitive":  15,
  "maxCrap":       30,
  "ignore": [
    "apps/server/src/api/**",
    "apps/server/src/mcp/**",
    "**/*.test.ts",
    "**/*.spec.ts",
    "packages/plugins/**"
  ]
}
```

`maxCyclomatic: 15` for module code (lowered from project default 20). Adapters ignored — Hono route handlers and MCP procedures legitimately have higher branching.

## Running fallow locally

```bash
fallow dead-code --format json --quiet 2>/dev/null | jq '.boundary_violations'
```

Returns `[]` when boundaries are clean. Any violation is a hard error — fix or get reviewer sign-off (rare).

```bash
fallow health --format json --quiet 2>/dev/null | jq '.functions[] | select(.cyclomatic > 15)'
```

Spots over-complex functions before they ship.

## Adding a new module

1. Create the directory `apps/server/src/<new>/` with the canonical layout (see [`module-layout.md`](module-layout.md)).
2. Add two zones to `.fallowrc.json` (narrower first).
3. Add two rules (`from: server-mod-<new>` and `from: server-mod-<new>-internal`) with the standard allow list.
4. Update other modules' rules: their allow lists should include `server-mod-<new>` if they will consume it. Or add `server-mod-<new>` to a shared wildcard if your config uses one.
5. Update `server-api` and `server-mcp` allow lists if adapters will call the module.
6. Wire `<new>.registerJobs()` into `apps/server/src/{index,worker}.ts` in alphabetical position.
7. Run `fallow dead-code` to confirm boundaries are clean.

## See also

- [`module-layout.md`](module-layout.md) — what each zone protects.
- [`events-and-jobs.md`](events-and-jobs.md) — why `<module>/jobs/**` is `-internal` not infra.
- [`db-ownership.md`](db-ownership.md) — parallel enforcement for tables.
