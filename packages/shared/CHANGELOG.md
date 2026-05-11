# @ent-mcp/shared

## 0.1.2

### Patch Changes

- ce2b0c5: Excluded the admin diagnostics namespace from HTTP perf capture so polling the Performance tab no longer skews its own samples, and made the perf aggregate endpoint honour the pinned request-id filter.

## 0.1.1

### Patch Changes

- db2b076: Added a batched artwork lookup so the home feed loads high-resolution posters and backdrops once cards are visible, with a graceful fallback to inline thumbnails while the lookup is in flight.
- 986fb74: Added the foundation for high-quality artwork on the home feed: TMDB now returns posters, backdrops, and clear logos through a new artwork capability that future plugins can extend.

## 0.1.0

### Minor Changes

- bde0d39: Move error severity out of individual `captureError` callsites and onto the code itself. The `HOST_ERROR_CODES` registry is now a keyed object of `{ severity }` specs — per-code-object shape is intentional so future metadata (translation hints, default HTTP status, category) can hang off it without a breaking refactor. `captureError` derives the effective severity via `meta.severity ?? severityFor(code)`; explicit severity still wins on recovered paths. Unknown codes default to `error` (over-capture rather than silently drop).

  Adds a third `info` severity level for expected user-input failures — bad URLs, wrong credentials, stale 404s, permission denied. `info` records are stored alongside `error` and `warning` so admins can filter them in when debugging a specific user flow, but the admin viewer's default filter keeps them hidden so the "something is wrong right now" signal is not drowned out. Removes the per-callsite `isUserInputError` gate in `plugin-runtime/runtime.ts` — the registry is now the single source of truth for the error-design-doc rule ("expected user-input failures don't enter the default error view").

- ec33991: Add `libraryAvailability@v1` and `continueWatching@v1` capability contracts for self-hosted media-server plugins (Plex, Jellyfin). Introduce a shared `LibraryItem` zod schema (`@ent-mcp/shared/plugins/library`) reused by both capabilities and earmarked for the upcoming `playbackSessions@v1` / `libraryAdmin@v1` contracts.
- c336404: Add admin-only advanced policy for installed plugins: per-plugin host allowlist
  override (intersection with `manifest.allowedHosts`) and encrypted custom headers
  injected into every `ctx.fetch` call. Blocked-host attempts are logged under a
  new `plugin.host_blocked_by_admin` error code. Plugins continue to see the
  existing `plugin.upstream_error` so no plugin changes are required.
- df3624f: Server bundle for the plugin-connections UI revamp (#39 #40 #41 #42 #43): widen the embedded plugin shape on `/api/connections/` to a full `PluginSummary` (renames `auth` → `authKind`, replaces flat `capabilities` with scoped arrays, drops `enabled`, adds `poolable` / `adminSharedAvailable` / `credentialsSchema`); compute `displayFields` server-side from `userConfigSchema` (excludes `x-secret`, redacts `x-private` to `••••`, marks URI / `x-mono` / `x-allowed-host` fields as `mono`); add `sharedCredentialsEnabledCount` and widen `sharedCredentialsCount` to total entries on `/api/plugins/`; rename `auth` → `authKind` on `/api/connections/available`; add `POST /api/plugins/:id/shared-credentials/test-ephemeral` for unsaved-credential probes; and add typed error codes `plugin.credentials_empty`, `plugin.duplicate_label`, `plugin.invalid_base_url` (the latter replacing `plugin.input_invalid` for `x-allowed-host` validation failures) so the frontend can route inline field errors. `listForUser` now hides connections to disabled plugins (matching the design doc's claim) and de-duplicates per-plugin work across rows; `/api/plugins/` derives both shared-credential counts from a single `list()` call.
- 09f1101: Add AuthorizedApp, RoleSummary, DeleteAccountBody, and PublicConfig to @ent-mcp/shared/users for the settings surface.
