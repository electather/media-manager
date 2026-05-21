# Per-module schema namespaces (Phase 4 of backend boundaries)

Status: design accepted. Implements TASK-050 from `plan/architecture-backend-boundaries-1.md` and the Phase 4 stub at
`docs/2026-05-17-backend-feature-architecture-design.md` §Phase 4.

## Problem

After Phases 1–3, ownership of drizzle tables is a convention enforced by `tools/check-table-ownership.ts`:

- Each schema file at `apps/server/src/db/schema/<file>.ts` declares `// @owner: <module>`.
- A separate Node script walks every module's TypeScript and fails CI on cross-module schema imports.

Two consequences:

1. The structural boundary lives in a hand-rolled AST script, not in the same engine (`fallow`) that enforces every other module boundary in the codebase. Two enforcers means two ways to drift.
2. The script's allowlist is the only escape hatch. Inserting a new cross-module schema import is *grep-able* but not *visible in fallow* — the boundary report shows zero violations while the script reports the real picture.

## Decision

Split `apps/server/src/db/schema/` into per-module subdirectories. File location encodes ownership; fallow zones encode access.

```
apps/server/src/db/schema/
├── index.ts                # root barrel
├── auth/{auth,users,roles,index}.ts
├── catalog/{catalog,id-map,index}.ts
├── home/{home,index}.ts
├── infra/{jobs,diagnostics,index}.ts          # server-infra owned
├── notifications/{notifications,index}.ts
├── plugin-runtime/{plugins,credentials,plugin-shared-credentials,index}.ts
├── preferences/{preferences,user-preferences,feedback,index}.ts
└── watchlist/{watchlist,index}.ts
```

Each subdirectory has an `index.ts` barrel re-exporting every table in that module. The root `index.ts` re-exports every subdirectory barrel — drizzle's schema entry point is unchanged.

### Fallow zones

Eight new zones, listed BEFORE `server-infra` in the zone array so first-match-wins routes per-module files away from the broad infra catch-all:

```jsonc
{ "name": "server-schema-auth",            "patterns": ["apps/server/src/db/schema/auth/**"] },
{ "name": "server-schema-catalog",         "patterns": ["apps/server/src/db/schema/catalog/**"] },
{ "name": "server-schema-home",            "patterns": ["apps/server/src/db/schema/home/**"] },
{ "name": "server-schema-notifications",   "patterns": ["apps/server/src/db/schema/notifications/**"] },
{ "name": "server-schema-plugin-runtime",  "patterns": ["apps/server/src/db/schema/plugin-runtime/**"] },
{ "name": "server-schema-preferences",     "patterns": ["apps/server/src/db/schema/preferences/**"] },
{ "name": "server-schema-watchlist",       "patterns": ["apps/server/src/db/schema/watchlist/**"] },
{ "name": "server-schema-infra",           "patterns": ["apps/server/src/db/schema/infra/**", "apps/server/src/db/schema/index.ts"] }
```

`server-schema-infra` also captures the root `index.ts` so the global barrel stays accessible to consumers (drizzle client, migrations runner, tests). The pattern is the precise file path, not `*.ts` — nothing else is expected at the schema root, and a future helper file landing there should pick a module subdirectory or extend `infra/` deliberately.

### Allow rules

Each module's `-internal` zone gets its own schema sub-zone in its allow list. Schema sub-zones may import from `server-schema-infra` and from peer schemas only when there is a foreign key (e.g. every per-user table joins to `auth.user`). The root `index.ts` and infra subdir continue to re-export everything — that is the only place where every schema is composed.

- `server-mod-auth-internal` → `server-schema-auth`
- `server-mod-catalog-internal` → `server-schema-catalog`, `server-schema-auth` (FK to user)
- … etc.

Three zones receive the full `server-schema-*` set: `server-infra`, `server-api`, and `server-mcp`. `server-infra` is load-bearing — `db/client.ts` constructs the drizzle client with the entire schema, `db/queries.ts` aggregates cross-module reads, `db/seed.ts` and `db/migrate.ts` touch every table, and the jobs runner reads schemas from every module to log run history. `server-api` and `server-mcp` are the host-side composition layers that route requests across every module; treating them as full schema consumers matches the way they aggregate cross-module reads through their domain services and avoids forcing every barrel re-export to thread schema types up through the modules.

Tightening this further would require splitting the drizzle client builder into per-module pieces — out of scope for Phase 4. The trade-off: a new utility file dropped into `apps/server/src/db/`, `apps/server/src/api/`, or `apps/server/src/mcp/` implicitly inherits cross-module table access. Reviewers of additions to those paths should treat fresh `db/schema/<module>` imports there as a smell unless the file is one of the global-schema consumers above.

Cross-module schema reads (the seven entries currently in `tools/check-table-ownership.ts`'s `ALLOWLIST`) DO NOT receive new cross-schema allows. Those crossings already route through the owner module's *barrel* in their `-internal` allow list (e.g. `server-mod-media-internal` already allows `server-mod-plugin-runtime`); the table import will need to be replaced with a barrel call as part of the deferred TASK-045/046/047 work. Until then each import is marked with a per-line `// fallow-ignore-next-line boundary-violation` directive carrying the TASK reference. The directive is a one-way ratchet — paired plan task required, mirroring the existing `ALLOWLIST` rule — but it is now *visible at the import site* instead of buried in a separate script.

Test helpers under `__tests__/` that seed fixtures are exempt from the TASK-reference requirement — fixture setup is not a production crossing and has no migration destination. The directive comment must still name the table being seeded so the skip is auditable. `apps/server/src/catalog/__tests__/helpers.ts` is the canonical example.

## Drizzle config

`drizzle.config.ts` continues to point at `./src/db/schema/index.ts`. The root barrel re-exports every subdirectory barrel, so drizzle-kit sees the same set of tables and migrations remain global.

## Ownership script

`tools/check-table-ownership.ts` becomes redundant for the structural rule it enforced. Two options:

1. **Delete** — fallow now catches structural violations.
2. **Keep, simplified** — strip the import-walking logic; keep only the lint that every file under `db/schema/<module>/` has a `// @owner: <module>` directive matching its directory. This is cheap insurance against a file with no directive landing in the wrong directory.

This design adopts option 1 — file location IS the directive, and a redundant directive is just another place for the two to disagree. The `@owner` comments are removed in the same PR.

## Migrations

Existing SQL migrations under `apps/server/drizzle/` are not affected. They reference table names, not file paths.

## Out of scope

- Refactoring the seven `ALLOWLIST` entries that currently bypass ownership. Those are TASK-045/046/047 in the parent plan and they land separately. After this PR they appear as concrete fallow boundary violations — a more honest baseline than the prior allowlist.
- Per-module migration directories. Migrations stay global; ownership is enforced at the read-write boundary only.

## Rollback

The split is structural and contained. Revert the PR — files move back to top level, fallow zones revert, drizzle config is untouched.
