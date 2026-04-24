---
"@ent-mcp/server": minor
"@ent-mcp/shared": minor
---

Move error severity out of individual `captureError` callsites and onto the code itself. The `HOST_ERROR_CODES` registry is now a keyed object of `{ severity }` specs — per-code-object shape is intentional so future metadata (translation hints, default HTTP status, category) can hang off it without a breaking refactor. `captureError` derives the effective severity via `meta.severity ?? severityFor(code)`; explicit severity still wins on recovered paths. Unknown codes default to `error` (over-capture rather than silently drop).

Adds a third `info` severity level for expected user-input failures — bad URLs, wrong credentials, stale 404s, permission denied. `info` records are stored alongside `error` and `warning` so admins can filter them in when debugging a specific user flow, but the admin viewer's default filter keeps them hidden so the "something is wrong right now" signal is not drowned out. Removes the per-callsite `isUserInputError` gate in `plugin-runtime/runtime.ts` — the registry is now the single source of truth for the error-design-doc rule ("expected user-input failures don't enter the default error view").
